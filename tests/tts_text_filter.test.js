#!/usr/bin/env node
const assert = require('assert');

const TtsTextFilter = require('../js/core/ttsTextFilter.js');

{
  const text = TtsTextFilter.prepareSpeechText(
    'Ветер хлещет по лицу. ((СИСТЕМА: требуется проверка STR.)) "Держать строй!" [COMMAND: {"do":"x"}]'
  );

  assert.equal(
    text,
    'Ветер хлещет по лицу. "Держать строй!"',
    'speech text should remove OOC blocks and commands while preserving narration and dialogue'
  );
}

{
  const text = TtsTextFilter.prepareSpeechTextFromHtml(`
    <div class="scene-episode-header">Боевой эпизод Высокая угроза combat rain</div>
    <div class="scene-visual-card">
      <div class="scene-visual-title">Атмосфера сцены</div>
      <div class="scene-visual-tags">combat · rain · fire</div>
    </div>
    <div class="scene-narrative-body"><p>Дождь сечет лица. Ты поднимаешь меч.</p></div>
    <div class="tts-controls-wrapper">Озвучить Stop</div>
  `);

  assert.equal(
    text,
    'Дождь сечет лица. Ты поднимаешь меч.',
    'speech text should prefer narrative body and ignore scene visual UI chrome'
  );
}

{
  const text = TtsTextFilter.prepareSpeechTextFromHtml(`
    <div class="message-bubble">
      <p>Первый абзац.</p>
      <span class="ooc-marker" data-ooc-text="hidden">OOC</span>
      <button>Restore</button>
      <p>Второй абзац.</p>
    </div>
  `);

  assert.equal(
    text,
    'Первый абзац. Второй абзац.',
    'speech text should remove buttons and OOC markers from generic bubbles'
  );
}

console.log('tts text filter tests OK');
