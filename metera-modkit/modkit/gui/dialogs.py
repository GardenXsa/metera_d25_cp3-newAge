"""Modal dialogs used by the GUI.

* ``NewModDialog`` — pick id, name, author, description and template.
* ``SettingsDialog`` — provider / model / API key / base URL /
  permission mode / temperature / max tokens.
* ``ConfirmDialog`` — generic yes / no prompt with optional danger
  styling.
"""

from __future__ import annotations

from typing import Any

from PySide6.QtCore import Qt, QThread, Signal
from PySide6.QtWidgets import (
    QCheckBox,
    QComboBox,
    QDialog,
    QDialogButtonBox,
    QDoubleSpinBox,
    QFormLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPushButton,
    QSpinBox,
    QTabWidget,
    QVBoxLayout,
    QWidget,
)

from modkit import templates
from modkit.config import Config, config_path, save
from modkit.providers.registry import list_providers

TEMPLATES = templates.TEMPLATES  # for display labels


def _validate_id(value: str) -> str | None:
    if not value:
        return "id не может быть пустым"
    import re

    if not re.fullmatch(r"[a-z0-9_]+", value):
        return "id: только [a-z0-9_]+"
    return None


class NewModDialog(QDialog):
    """Modal that asks for id / name / author / description / template."""

    def __init__(self, parent: QWidget | None = None, default_author: str = "Unknown") -> None:
        super().__init__(parent)
        self.setWindowTitle("Создать новый мод")
        self.setMinimumWidth(420)

        layout = QVBoxLayout(self)
        layout.addWidget(QLabel("<b>Создать новый мод</b>"))
        layout.addWidget(QLabel("id (латиница / цифры / _):"))

        self.id_input = QLineEdit()
        self.id_input.setPlaceholderText("my_cool_mod")
        layout.addWidget(self.id_input)

        form = QFormLayout()
        self.name_input = QLineEdit()
        self.author_input = QLineEdit(default_author)
        self.desc_input = QLineEdit()
        self.template_combo = QComboBox()
        for key, label, _fn in TEMPLATES:
            self.template_combo.addItem(f"{key}  —  {label}", key)
        form.addRow("Название:", self.name_input)
        form.addRow("Автор:", self.author_input)
        form.addRow("Описание:", self.desc_input)
        form.addRow("Шаблон:", self.template_combo)
        layout.addLayout(form)

        buttons = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel
        )
        buttons.accepted.connect(self._on_accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

    def _on_accept(self) -> None:
        mod_id = self.id_input.text().strip()
        err = _validate_id(mod_id)
        if err:
            QMessageBox.warning(self, "Ошибка", err)
            return
        self.accept()

    def result_data(self) -> dict[str, Any]:
        return {
            "id": self.id_input.text().strip(),
            "name": self.name_input.text().strip(),
            "author": self.author_input.text().strip() or "Unknown",
            "description": self.desc_input.text().strip(),
            "template": self.template_combo.currentData(),
        }


class ModelComboBox(QComboBox):
    popup_opened = Signal()

    def setText(self, text: str) -> None:
        self.setCurrentText(text)

    def text(self) -> str:
        return self.currentText()

    def showPopup(self) -> None:
        self.popup_opened.emit()
        super().showPopup()


class _PingWorker(QThread):
    result = Signal(bool, str)

    def __init__(self, cfg: Config) -> None:
        super().__init__()
        self.cfg = cfg

    def run(self) -> None:
        try:
            from modkit.providers import build_provider
            provider = build_provider(
                provider_id=self.cfg.provider,
                api_key=self.cfg.api_keys.get(self.cfg.provider, ""),
                model=self.cfg.model or "",
                base_url=self.cfg.base_url or "",
                temperature=self.cfg.temperature,
                max_tokens=self.cfg.max_tokens,
            )
            ping_msg = provider.ping()
            self.result.emit(True, ping_msg)
        except Exception as exc:
            self.result.emit(False, str(exc))


class _LoadModelsWorker(QThread):
    result = Signal(str, list, str)

    def __init__(self, cfg: Config, cache_key: str) -> None:
        super().__init__()
        self.cfg = cfg
        self.cache_key = cache_key

    def run(self) -> None:
        try:
            from modkit.providers import build_provider
            provider = build_provider(
                provider_id=self.cfg.provider,
                api_key=self.cfg.api_keys.get(self.cfg.provider, ""),
                model=self.cfg.model or "",
                base_url=self.cfg.base_url or "",
                temperature=self.cfg.temperature,
                max_tokens=self.cfg.max_tokens,
            )
            models = provider.get_models()
            self.result.emit(self.cache_key, models, "")
        except Exception as exc:
            self.result.emit(self.cache_key, [], str(exc))


class SettingsDialog(QDialog):
    """Modal that edits the modkit ``Config`` (provider, API key, model, etc.).

    The dialog commits the new config to disk on accept and exposes
    ``updated_config`` so callers can re-instantiate the AI provider
    without restarting the GUI.
    """

    PERMISSION_MODES = [
        ("ask", "Спрашивать перед каждой операцией"),
        ("auto-edit", "Авто-правка файлов, shell — спрашивать"),
        ("yolo", "Всё разрешено (без подтверждений)"),
    ]

    def __init__(self, cfg: Config, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setWindowTitle("Настройки — metera-modkit")
        self.setMinimumSize(560, 480)
        self._cfg = cfg
        self._providers = list_providers()
        self.updated_config: Config | None = None

        self._models_cache: dict[str, list[str]] = {}
        self._models_worker: _LoadModelsWorker | None = None

        layout = QVBoxLayout(self)
        tabs = QTabWidget()
        layout.addWidget(tabs, 1)

        tabs.addTab(self._build_ai_tab(), "AI-провайдер")
        tabs.addTab(self._build_agent_tab(), "Агент")
        tabs.addTab(self._build_paths_tab(), "Пути")

        buttons = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Ok
            | QDialogButtonBox.StandardButton.Cancel
            | QDialogButtonBox.StandardButton.Apply
        )
        self._apply_btn = buttons.button(QDialogButtonBox.StandardButton.Apply)
        self._apply_btn.clicked.connect(self._on_apply)
        buttons.accepted.connect(self._on_ok)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

    def _build_ai_tab(self) -> QWidget:
        wrap = QWidget()
        form = QFormLayout(wrap)

        self.provider_combo = QComboBox()
        for spec in self._providers:
            self.provider_combo.addItem(f"{spec.name}  —  {spec.id}", spec.id)
        idx = self.provider_combo.findData(self._cfg.provider or "dummy")
        if idx < 0:
            idx = 0
        self.provider_combo.setCurrentIndex(idx)
        self.provider_combo.currentIndexChanged.connect(self._on_provider_changed)
        form.addRow("Провайдер:", self.provider_combo)

        self.model_input = ModelComboBox()
        self.model_input.setEditable(True)
        self.model_input.setCurrentText(self._cfg.model or "")
        self.model_input.setPlaceholderText("например gpt-4o-mini, claude-3-5-sonnet, …")
        self.model_input.popup_opened.connect(self._on_model_popup)
        form.addRow("Модель:", self.model_input)

        self.ping_btn = QPushButton("Пинг (проверка связи)")
        self.ping_btn.clicked.connect(self._on_ping)
        self.ping_status = QLabel("")
        self.ping_status.setWordWrap(True)
        ping_row = QHBoxLayout()
        ping_row.addWidget(self.ping_btn)
        ping_row.addWidget(self.ping_status, 1)
        form.addRow("", ping_row)

        self.base_url_input = QLineEdit(self._cfg.base_url or "")
        self.base_url_input.setPlaceholderText("https://…  (оставь пустым для дефолта провайдера)")
        form.addRow("Base URL:", self.base_url_input)

        self.api_key_input = QLineEdit(self._current_api_key())
        self.api_key_input.setEchoMode(QLineEdit.EchoMode.Password)
        self.api_key_input.setPlaceholderText("sk-…  (или возьми из переменной окружения)")
        self.show_key_check = QCheckBox("показать ключ")
        self.show_key_check.toggled.connect(
            lambda on: self.api_key_input.setEchoMode(
                QLineEdit.EchoMode.Normal if on else QLineEdit.EchoMode.Password
            )
        )
        key_row = QHBoxLayout()
        key_row.addWidget(self.api_key_input, 1)
        key_row.addWidget(self.show_key_check)
        key_wrap = QWidget()
        key_wrap.setLayout(key_row)
        form.addRow("API ключ:", key_wrap)

        self.use_env_check = QCheckBox("использовать переменную окружения (если ключ пустой)")
        self.use_env_check.setChecked(True)
        form.addRow("", self.use_env_check)

        self._env_label = QLabel("")
        self._env_label.setStyleSheet("color: gray;")
        form.addRow("", self._env_label)

        self._update_provider_info()
        return wrap

    def _build_agent_tab(self) -> QWidget:
        wrap = QWidget()
        form = QFormLayout(wrap)

        self.mode_combo = QComboBox()
        for value, label in self.PERMISSION_MODES:
            self.mode_combo.addItem(label, value)
        idx = next(
            (i for i, (v, _) in enumerate(self.PERMISSION_MODES) if v == self._cfg.permission_mode),
            0,
        )
        self.mode_combo.setCurrentIndex(idx)
        form.addRow("Режим разрешений:", self.mode_combo)

        self.temp_spin = QDoubleSpinBox()
        self.temp_spin.setRange(0.0, 2.0)
        self.temp_spin.setSingleStep(0.1)
        self.temp_spin.setValue(self._cfg.temperature)
        form.addRow("Temperature:", self.temp_spin)

        self.tokens_spin = QSpinBox()
        self.tokens_spin.setRange(64, 32768)
        self.tokens_spin.setSingleStep(64)
        self.tokens_spin.setValue(self._cfg.max_tokens)
        form.addRow("Max tokens:", self.tokens_spin)

        self.iter_spin = QSpinBox()
        self.iter_spin.setRange(1, 200)
        self.iter_spin.setValue(self._cfg.max_iterations)
        form.addRow("Max итераций агента:", self.iter_spin)

        return wrap

    def _build_paths_tab(self) -> QWidget:
        wrap = QWidget()
        form = QFormLayout(wrap)

        self.mods_dir_input = QLineEdit(self._cfg.mods_dir or "")
        self.mods_dir_input.setPlaceholderText("оставь пустым — берётся из modkit.paths")
        form.addRow("Mods dir (переопределение):", self.mods_dir_input)

        path_label = QLabel(f"Конфиг: <code>{config_path()}</code>")
        path_label.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
        path_label.setWordWrap(True)
        form.addRow("", path_label)

        return wrap

    def _current_api_key(self) -> str:
        pid = self._cfg.provider or "dummy"
        return self._cfg.api_keys.get(pid, "")

    def _on_provider_changed(self, _idx: int) -> None:
        pid = self.provider_combo.currentData() or "dummy"
        spec = next((p for p in self._providers if p.id == pid), None)
        if spec:
            self.model_input.clear()
            self.model_input.setCurrentText(spec.default_model)
            self.base_url_input.setText(spec.default_base_url)
            self.api_key_input.setText(self._cfg.api_keys.get(spec.id, ""))
        self._update_provider_info()

    def _update_provider_info(self) -> None:
        pid = self.provider_combo.currentData() or "dummy"
        spec = next((p for p in self._providers if p.id == pid), None)
        if spec is None:
            self._env_label.setText("")
            return
        env = Config._env_for(spec.id)
        bits = [f"env: <code>{env}</code>"]
        if spec.default_model:
            bits.append(f"модель по умолчанию: <code>{spec.default_model}</code>")
        if spec.default_base_url:
            bits.append(f"base URL: <code>{spec.default_base_url}</code>")
        if not spec.requires_api_key:
            bits.append("<i>API ключ не обязателен</i>")
        self._env_label.setText("  ·  ".join(bits))
        if not self.model_input.currentText().strip() and spec.default_model:
            self.model_input.setCurrentText(spec.default_model)
        if not self.base_url_input.text().strip() and spec.default_base_url:
            self.base_url_input.setText(spec.default_base_url)
        if not self.api_key_input.text() or self.api_key_input.text() == self._current_api_key():
            self.api_key_input.setText(self._cfg.api_keys.get(spec.id, ""))

    def _build_config(self) -> Config:
        new_cfg = Config(
            provider=self.provider_combo.currentData() or "dummy",
            model=self.model_input.currentText().strip(),
            base_url=self.base_url_input.text().strip(),
            api_keys=dict(self._cfg.api_keys),
            permission_mode=self.mode_combo.currentData() or "ask",
            temperature=float(self.temp_spin.value()),
            max_tokens=int(self.tokens_spin.value()),
            max_iterations=int(self.iter_spin.value()),
            mods_dir=self.mods_dir_input.text().strip(),
        )
        key = self.api_key_input.text().strip()
        if key:
            new_cfg.api_keys[new_cfg.provider] = key
        return new_cfg

    def _on_ping(self) -> None:
        self.ping_btn.setEnabled(False)
        self.ping_status.setText("Проверка...")
        self.ping_status.setStyleSheet("color: #888;")
        cfg = self._build_config()
        self._ping_worker = _PingWorker(cfg)
        self._ping_worker.result.connect(self._on_ping_result)
        self._ping_worker.start()

    def _on_ping_result(self, ok: bool, msg: str) -> None:
        self.ping_btn.setEnabled(True)
        if ok:
            self.ping_status.setText("✓ Пинг успешен! Модель поддерживает tools.")
            self.ping_status.setStyleSheet("color: #5fa55a;")
        else:
            self.ping_status.setText(f"❌ Ошибка: {msg}")
            self.ping_status.setStyleSheet("color: #cf6679;")

    def _on_model_popup(self) -> None:
        cfg = self._build_config()
        cache_key = f"{cfg.provider}|{cfg.api_keys.get(cfg.provider, '')}|{cfg.base_url}"
        
        if cache_key in self._models_cache:
            models = self._models_cache[cache_key]
            if models:
                current = self.model_input.currentText()
                self.model_input.clear()
                self.model_input.addItems(models)
                self.model_input.setCurrentText(current)
            return

        if self._models_worker is not None and self._models_worker.isRunning():
            return

        self._models_worker = _LoadModelsWorker(cfg, cache_key)
        self._models_worker.result.connect(self._on_models_loaded)
        self._models_worker.start()

    def _on_models_loaded(self, cache_key: str, models: list[str], err: str) -> None:
        if err:
            self._models_cache[cache_key] = []
            return
            
        self._models_cache[cache_key] = models
        if models:
            current = self.model_input.currentText()
            self.model_input.clear()
            self.model_input.addItems(models)
            self.model_input.setCurrentText(current)

    def _on_apply(self) -> None:
        try:
            new_cfg = self._build_config()
            save(new_cfg)
            self.updated_config = new_cfg
            self._cfg = new_cfg
        except OSError as exc:
            QMessageBox.critical(self, "Ошибка", f"Не удалось сохранить: {exc}")

    def _on_ok(self) -> None:
        self._on_apply()
        if self.updated_config is not None:
            self.accept()
        else:
            self.reject()


def confirm(parent: QWidget | None, prompt: str, *, danger: bool = False) -> bool:
    """Show a yes / no confirmation dialog. Returns True on yes."""
    box = QMessageBox(parent)
    box.setIcon(
        QMessageBox.Icon.Warning if danger else QMessageBox.Icon.Question
    )
    box.setWindowTitle("Подтверждение")
    box.setText(prompt)
    yes = box.addButton("Да", QMessageBox.ButtonRole.YesRole)
    box.addButton("Нет", QMessageBox.ButtonRole.NoRole)
    box.setDefaultButton(yes if danger else box.addButton("Отмена", QMessageBox.ButtonRole.RejectRole))
    box.exec()
    clicked = box.clickedButton()
    if clicked is None:
        return False
    text = clicked.text().lower()
    return text.startswith("да")
