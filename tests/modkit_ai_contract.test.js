const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const modkitPath = path.join(root, 'ModKit.py');
const source = fs.readFileSync(modkitPath, 'utf8');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

test('ModKit exposes only supported native tool-call AI providers', () => {
  const supportedProviders = [
    'gemini',
    'openrouter',
    'deepseek',
    'local',
    'dummy',
    'openai',
    'anthropic',
    'groq',
    'mistral',
    'cohere',
    'together',
    'fireworks',
    'xai',
    'cerebras',
    'github_models',
    'azure_openai',
    'custom',
  ];

  for (const id of supportedProviders) {
    assert(source.includes(`"${id}": {`), `missing AI_PROVIDERS entry: ${id}`);
  }

  for (const id of ['llmost', 'omniroute', 'perplexity']) {
    assert(!source.includes(`"${id}": {`), `unsupported provider should be removed: ${id}`);
  }
});

test('ModKit stores provider capability metadata for UI and routing', () => {
  assert(source.includes('VANILLA_PROVIDER_IDS'), 'missing vanilla provider group');
  assert(source.includes('_provider_cfg.setdefault("category"'), 'missing category normalization');
  assert(source.includes('_provider_cfg.setdefault("requires_api_key"'), 'missing API-key requirement normalization');
  assert(source.includes('"dummy": {') && source.includes('"auth_type": "none"'), 'dummy provider must not require auth');
});

test('ModKit uses one OpenAI-compatible provider group instead of a short hardcoded tuple', () => {
  assert(source.includes('OPENAI_COMPATIBLE_PROVIDER_IDS'), 'missing shared OpenAI-compatible provider set');
  for (const id of ['groq', 'mistral', 'cohere', 'together', 'fireworks', 'xai', 'cerebras', 'github_models', 'azure_openai']) {
    assert(source.includes(`"${id}"`), `OpenAI-compatible routing does not mention ${id}`);
  }
  for (const id of ['llmost', 'omniroute', 'perplexity']) {
    assert(!source.includes(`"${id}"`), `unsupported provider should not be routed as OpenAI-compatible: ${id}`);
  }
});

test('ModKit settings window includes full AI provider controls', () => {
  const settingsStart = source.indexOf('def open_settings(self):');
  assert(settingsStart !== -1, 'open_settings is missing');
  const settingsSource = source.slice(settingsStart);
  assert(settingsSource.includes('AI provider'), 'settings window does not render an AI provider selector');
  assert(settingsSource.includes('CTkOptionMenu'), 'settings window lacks a provider option menu');
  assert(settingsSource.includes('_on_provider_change'), 'settings provider selector does not update model/url controls');
  assert(settingsSource.includes('ping_ai_provider'), 'settings window lacks provider ping');
});

test('ModKit can return a dummy AI response without network or API key', () => {
  assert(source.includes('provider == "dummy"'), 'dummy provider branch is missing');
  assert(source.includes('_build_dummy_ai_response'), 'dummy response helper is missing');
  assert(source.includes('provider not in ("local", "dummy")'), 'send path should allow dummy without API key');
});

test('ModKit AI assistant exposes a CLI-style agent tool loop', () => {
  const requiredMethods = [
    '_build_agent_context',
    '_extract_agent_tool_calls',
    '_execute_agent_tool',
    '_run_agent_turn',
    '_append_agent_log',
    '_confirm_agent_tool',
    '_safe_mod_path',
  ];

  for (const method of requiredMethods) {
    assert(source.includes(`def ${method}(`), `missing agent method: ${method}`);
  }

  const requiredTools = [
    'shell',
    'list_files',
    'read_file',
    'write_file',
    'replace_file',
    'replace_lines',
    'insert_after',
    'delete_file',
    'validate_json',
    'validate_mod',
    'open_file',
    'save_editor',
  ];

  for (const tool of requiredTools) {
    assert(source.includes(`"${tool}"`), `missing CLI agent tool: ${tool}`);
  }
});

test('ModKit agent tools are sandboxed and approval-gated', () => {
  assert(source.includes('subprocess.run'), 'shell tool should execute through subprocess.run');
  assert(source.includes('cwd=self._get_current_mod_path()'), 'shell tool should run from the selected mod directory');
  assert(source.includes('messagebox.askyesno'), 'mutating tools should ask user approval');
  assert(source.includes('"denied": True') || source.includes('"denied": true'), 'tool denial should be returned to the model');
  assert(source.includes('_safe_mod_path'), 'file tools should resolve through safe path checks');
  assert(source.includes('os.path.commonpath'), 'safe path checks should block escaping the selected mod folder');
});

test('ModKit supports native streaming tool calls for OpenAI-compatible providers', () => {
  const requiredMethods = [
    'http_stream_json_events',
    '_openai_agent_tool_definitions',
    '_call_openai_streaming_tools',
    '_provider_supports_native_stream_tools',
    '_call_agent_model',
  ];

  for (const method of requiredMethods) {
    assert(source.includes(`def ${method}(`), `missing native stream method: ${method}`);
  }

  assert(source.includes('OPENAI_TOOL_STREAM_PROVIDER_IDS'), 'missing provider group for native stream tools');
  assert(source.includes('"stream": True'), 'native tool body should enable stream mode');
  assert(source.includes('"tools": self._openai_agent_tool_definitions()'), 'native tool body should include OpenAI tool schemas');
  assert(source.includes('"tool_choice": "auto"'), 'native tool body should allow automatic tool choice');
  assert(source.includes('delta.get("tool_calls"'), 'stream parser should read delta.tool_calls');
  assert(source.includes('finish_reason') && source.includes('tool_calls'), 'stream parser should handle tool_calls finish reason');
  assert(source.includes('"role": "tool"'), 'native agent loop should return tool results as tool messages');
  assert(source.includes('"tool_call_id"'), 'native tool result messages should be linked to requested tool calls');
  assert(source.includes('"openai_tool_calls"'), 'stream parser should preserve raw OpenAI tool calls for follow-up messages');
});

test('ModKit routes native streaming tool calls for every configured provider', () => {
  const requiredMethods = [
    '_native_tool_stream_family',
    '_gemini_agent_tool_definitions',
    '_anthropic_agent_tool_definitions',
    '_call_gemini_streaming_tools',
    '_call_anthropic_streaming_tools',
    '_call_dummy_streaming_tools',
    '_append_native_tool_results',
  ];

  for (const method of requiredMethods) {
    assert(source.includes(`def ${method}(`), `missing all-provider native stream method: ${method}`);
  }

  assert(source.includes('NATIVE_TOOL_STREAM_PROVIDER_IDS = ('), 'native stream provider set should be explicit');
  assert(source.includes('GEMINI_TOOL_STREAM_PROVIDER_IDS = ("gemini",)'), 'Gemini should have a native stream provider group');
  assert(source.includes('ANTHROPIC_TOOL_STREAM_PROVIDER_IDS = ("anthropic",)'), 'Anthropic should have a native stream provider group');
  assert(source.includes('DUMMY_TOOL_STREAM_PROVIDER_IDS = ("dummy",)'), 'Dummy should have a native offline provider group');
  assert(source.includes('return self._call_gemini_streaming_tools'), 'agent model router should call Gemini native adapter');
  assert(source.includes('return self._call_anthropic_streaming_tools'), 'agent model router should call Anthropic native adapter');
  assert(source.includes('return self._call_dummy_streaming_tools'), 'agent model router should call dummy native adapter');
  assert(source.includes(':streamGenerateContent'), 'Gemini adapter should use the streaming content endpoint');
  assert(source.includes('"functionDeclarations"'), 'Gemini adapter should send function declarations');
  assert(source.includes('"functionResponse"'), 'Gemini follow-up should return functionResponse parts');
  assert(source.includes('"tool_use"'), 'Anthropic adapter should parse tool_use blocks');
  assert(source.includes('"tool_result"'), 'Anthropic follow-up should return tool_result blocks');
  assert(source.includes('"input_json_delta"'), 'Anthropic stream parser should accumulate streamed tool input JSON');
});

test('ModKit preserves Gemini thought signatures during native tool loops', () => {
  assert(source.includes('gemini_model_parts'), 'Gemini stream parser should preserve raw model parts');
  assert(source.includes('thoughtSignature'), 'Gemini stream parser should preserve thoughtSignature fields');
  assert(source.includes('dict(part)'), 'Gemini parser should copy the raw part instead of rebuilding functionCall history');
  assert(source.includes('native_messages.append({"role": "model", "parts": gemini_model_parts})'), 'Gemini follow-up should append raw model parts with signatures');
  assert(!source.includes('"gemini_tool_parts"'), 'Gemini follow-up should not use rebuilt functionCall parts without signatures');
});

test('ModKit keeps CLI tool protocol when native streaming falls back', () => {
  assert(source.includes('def _build_agent_tool_protocol_prompt('), 'missing reusable CLI tool protocol prompt');
  assert(source.includes('def _build_agent_followup_prompt('), 'missing CLI follow-up prompt builder');
  assert(source.includes('fallback_message = self._build_agent_tool_protocol_prompt(message)'), 'native fallback should keep tool protocol');
  assert(source.includes('self._build_agent_followup_prompt(tool_results)'), 'agent loop should preserve protocol after tool results');
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
