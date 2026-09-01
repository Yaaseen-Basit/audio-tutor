import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Play, Pause, SkipBack, SkipForward, Upload, RotateCcw,
  Radio, Activity, Volume2, AlertTriangle, Sparkles, ChevronRight
} from "lucide-react";

/* ============================================================
   SONIFICATION ENGINE — native Web Audio API, zero pre-recorded
   assets. All tones are synthesized mathematically in real time.
   ============================================================ */

const SCALE_STEPS = [0, 3, 5, 7, 10]; // A minor pentatonic, relative semitones to A4
function buildPentatonicScale() {
  const freqs = [];
  for (let oct = -1; oct <= 2; oct++) {
    SCALE_STEPS.forEach((s) => {
      const semitones = oct * 12 + s;
      freqs.push(440 * Math.pow(2, semitones / 12));
    });
  }
  return freqs.filter((f) => f >= 200 && f <= 1800).sort((a, b) => a - b);
}
const PENTATONIC = buildPentatonicScale();

function quantizeFrequency(freq) {
  if (!isFinite(freq)) return PENTATONIC[Math.floor(PENTATONIC.length / 2)];
  return PENTATONIC.reduce((prev, curr) =>
    Math.abs(curr - freq) < Math.abs(prev - freq) ? curr : prev
  );
}

const TIMBRE_FILTER_CUTOFF = { sine: 5200, triangle: 3400, sawtooth: 2200, square: 2600 };

class SonificationEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.unlocked = false;
  }
  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) throw new Error("Web Audio API unsupported in this browser.");
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.4;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === "suspended") this.ctx.resume();
      this.unlocked = true;
      return true;
    } catch (e) {
      this.unlocked = false;
      return false;
    }
  }
  playTone({ frequencyHz, stereoPan = 0, durationSec = 0.4, timberType = "sine" }) {
    if (!this.ctx || !this.unlocked) return;
    const t0 = this.ctx.currentTime;
    const freq = quantizeFrequency(frequencyHz);
    const osc = this.ctx.createOscillator();
    osc.type = ["sine", "triangle", "sawtooth", "square"].includes(timberType) ? timberType : "sine";
    osc.frequency.setValueAtTime(freq, t0);

    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(TIMBRE_FILTER_CUTOFF[osc.type] || 4000, t0);
    filter.Q.setValueAtTime(0.7, t0);

    const pan = this.ctx.createStereoPanner();
    pan.pan.setValueAtTime(Math.max(-1, Math.min(1, stereoPan)), t0);

    const gain = this.ctx.createGain();
    const dur = Math.max(0.08, durationSec);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(0.55, t0 + Math.min(0.02, dur / 4));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(filter);
    filter.connect(pan);
    pan.connect(gain);
    gain.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
    return freq;
  }
  speak(text) {
    if (!window.speechSynthesis || !text) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1.08;
    utter.pitch = 1.0;
    window.speechSynthesis.speak(utter);
  }
  stopSpeech() {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  }
}

/* ============================================================
   PRESETS — concrete STEM data payloads for quick testing
   ============================================================ */

const PRESETS = {
  bubblesort: {
    label: "BubbleSort trace: [5, 2, 8, 1, 9]",
    text:
      "Trace the BubbleSort algorithm executing on the array [5, 2, 8, 1, 9]. " +
      "For each comparison and swap, describe the two array indices involved, " +
      "their values, and whether a swap occurred.",
  },
  revenue: {
    label: "Q3 Revenue Bar Chart",
    text:
      "A bar chart titled 'Q3 Revenue by Region' has four bars, left to right: " +
      "North America = 42, Europe = 31, APAC = 58, LATAM = 19 (values in $M). " +
      "Sonify the chart so each bar is one node, ordered left to right.",
  },
  bst: {
    label: "Binary Search Tree (7 nodes)",
    text:
      "A binary search tree has root 50, with left child 30 and right child 70. " +
      "30 has left child 20 and right child 40. 70 has left child 60 and right " +
      "child 90. Sonify a pre-order traversal (root, then left subtree, then " +
      "right subtree), mapping tree depth to timbre and left/right position to panning.",
  },
  sigmoid: {
    label: "Sigmoid Curve σ(x)",
    text:
      "The sigmoid function σ(x) = 1 / (1 + e^-x) sampled at x = -3, -2, -1, 0, 1, 2, 3, " +
      "producing y ≈ 0.047, 0.119, 0.269, 0.5, 0.731, 0.881, 0.953. Sonify the curve " +
      "left to right across x, mapping y to pitch.",
  },
};

/* ============================================================
   AGENT: tool schema + system prompt for the planner/critic loop
   ============================================================ */

const TOOLS = [
  {
    name: "defineSpatialBounds",
    description: "Calibrate the virtual acoustic canvas before any tones are scheduled. Call this first, exactly once.",
    input_schema: {
      type: "object",
      properties: {
        xMin: { type: "number" }, xMax: { type: "number" },
        yMin: { type: "number" }, yMax: { type: "number" },
      },
      required: ["xMin", "xMax", "yMin", "yMax"],
    },
  },
  {
    name: "setPlaybackTempo",
    description: "Set the relative timeline speed. Call this second, exactly once.",
    input_schema: {
      type: "object",
      properties: { bpmMultiplier: { type: "number" } },
      required: ["bpmMultiplier"],
    },
  },
  {
    name: "scheduleTone",
    description: "Schedule one micro-tone representing a single semantic data node (an array index, a bar, a tree node, a sample point).",
    input_schema: {
      type: "object",
      properties: {
        frequencyHz: { type: "number", description: "220-1760 Hz. Low value -> low pitch, high value -> high pitch." },
        stereoPan: { type: "number", description: "-1.0 (full left) to 1.0 (full right), position along the x-axis / sequence." },
        durationSec: { type: "number" },
        delayOffsetSec: { type: "number", description: "Cumulative offset from timeline start." },
        timberType: { type: "string", enum: ["sine", "triangle", "sawtooth", "square"], description: "sine=root/normal, triangle=nested/branch, sawtooth=anomaly/peak, square=comparison/pivot." },
      },
      required: ["frequencyHz", "stereoPan", "durationSec", "delayOffsetSec", "timberType"],
    },
  },
  {
    name: "scheduleSpeechMarker",
    description: "Emit a short plain-language screen-reader cue describing the node just scheduled with scheduleTone.",
    input_schema: {
      type: "object",
      properties: {
        textLabel: { type: "string", description: "Under 12 words, e.g. 'Index 2, value 8, comparing'." },
        delayOffsetSec: { type: "number" },
      },
      required: ["textLabel", "delayOffsetSec"],
    },
  },
];

const SYSTEM_PROMPT = `You are the planning core of AudioTutor-Agent, an agentic sonification system for blind and low-vision STEM learners.
Given a description of code execution, a chart, or a data structure, deconstruct it into an ORDERED sequence of semantic nodes and express the plan ENTIRELY as tool calls. Do not explain in prose.

Conventions:
- Call defineSpatialBounds exactly once, first.
- Call setPlaybackTempo exactly once, second.
- Then for EACH semantic node (in order): call scheduleTone, immediately followed by scheduleSpeechMarker describing it in under 12 words.
- frequencyHz must fall between 220 and 1760, mapped so low data values are low pitches and high data values are high pitches.
- stereoPan must move from -1.0 toward 1.0 as the node's position/index/x advances left to right.
- timberType: sine for a normal/root node, triangle for a nested or branch node, sawtooth for an anomaly, peak, or swap, square for a comparison or pivot.
- delayOffsetSec should increase cumulatively (e.g. 0, 0.5, 1.0, ...).
- Limit the plan to AT MOST 8 nodes total so the response stays concise.
- You MUST call the tools directly using the tool-calling mechanism. Never describe a call as text, code fences, or pseudo-code — every action has to be a real tool invocation with exactly the parameter names given in the tool schema (frequencyHz, stereoPan, durationSec, delayOffsetSec, timberType, textLabel, bpmMultiplier, xMin, xMax, yMin, yMax). Do not invent alternate parameter names.`;

function getField(obj, ...keys) {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

// Best-effort recovery when the model writes tool calls as text instead of
// real tool_use blocks (fenced pseudo-code like `toolName({...})`).
function extractPseudoToolCalls(text) {
  const calls = [];
  const re = /(defineSpatialBounds|setPlaybackTempo|scheduleTone|scheduleSpeechMarker)\s*\(\s*(\{[\s\S]*?\})\s*\)/g;
  let m;
  while ((m = re.exec(text))) {
    try {
      calls.push({ name: m[1], input: JSON.parse(m[2]) });
    } catch (e) {
      /* skip unparsable fragment */
    }
  }
  return calls;
}

/* ============================================================
   LOCAL FALLBACK PLANNER — deterministic, no network required.
   Used automatically if the API call fails.
   ============================================================ */

function localPlan(presetKey) {
  const bounds = { xMin: 0, xMax: 4, yMin: 0, yMax: 100 };
  const nodes = [];
  const push = (freqVal, pan, timbre, label) =>
    nodes.push({ frequencyHz: 220 + Math.max(0, Math.min(1, freqVal)) * 1540, stereoPan: pan, durationSec: 0.42, timberType: timbre, textLabel: label });

  if (presetKey === "bubblesort") {
    const arr = [5, 2, 8, 1, 9];
    const steps = [];
    const a = [...arr];
    for (let i = 0; i < a.length - 1; i++) {
      for (let j = 0; j < a.length - 1 - i; j++) {
        steps.push({ i: j, j: j + 1, vi: a[j], vj: a[j + 1], swap: a[j] > a[j + 1] });
        if (a[j] > a[j + 1]) [a[j], a[j + 1]] = [a[j + 1], a[j]];
      }
    }
    steps.slice(0, 8).forEach((s) => {
      const pan = (s.i / (arr.length - 1)) * 2 - 1;
      push(s.vi / 9, pan, s.swap ? "sawtooth" : "square", `Compare index ${s.i} and ${s.j}${s.swap ? ", swap" : ""}`);
    });
  } else if (presetKey === "revenue") {
    const regions = [["North America", 42], ["Europe", 31], ["APAC", 58], ["LATAM", 19]];
    regions.forEach(([name, val], idx) => {
      const pan = (idx / (regions.length - 1)) * 2 - 1;
      push(val / 60, pan, "sine", `${name}, ${val} million`);
    });
  } else if (presetKey === "bst") {
    const order = [
      ["50", 0, "sine"], ["30", -0.6, "triangle"], ["20", -0.9, "sawtooth"],
      ["40", -0.3, "sawtooth"], ["70", 0.6, "triangle"], ["60", 0.3, "sawtooth"], ["90", 0.9, "sawtooth"],
    ];
    order.forEach(([val, pan, timbre]) => push(Number(val) / 100, pan, timbre, `Node ${val}`));
  } else {
    const xs = [-3, -2, -1, 0, 1, 2, 3];
    const ys = xs.map((x) => 1 / (1 + Math.exp(-x)));
    xs.forEach((x, idx) => {
      const pan = (idx / (xs.length - 1)) * 2 - 1;
      push(ys[idx], pan, "sine", `x = ${x}, sigma = ${ys[idx].toFixed(2)}`);
    });
  }
  return { bounds, tempo: 1, nodes };
}

/* ============================================================
   MAIN APP
   ============================================================ */

export default function App() {
  const [audioReady, setAudioReady] = useState(false);
  const [inputMode, setInputMode] = useState("preset");
  const [presetKey, setPresetKey] = useState("bubblesort");
  const [freeText, setFreeText] = useState("");
  const [imageData, setImageData] = useState(null); // { base64, mediaType, name }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [telemetry, setTelemetry] = useState([]);
  const [bounds, setBounds] = useState(null);
  const [tempo, setTempo] = useState(1);
  const [nodes, setNodes] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [liveMsg, setLiveMsg] = useState("");

  const engineRef = useRef(null);
  const timeoutRef = useRef(null);
  const telemetryEndRef = useRef(null);
  if (!engineRef.current) engineRef.current = new SonificationEngine();

  const log = useCallback((kind, message) => {
    setTelemetry((t) => [...t.slice(-59), { kind, message, id: Math.random().toString(36).slice(2) }]);
  }, []);

  useEffect(() => {
    telemetryEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [telemetry]);

  const enableAudio = () => {
    const ok = engineRef.current.unlock();
    setAudioReady(ok);
    if (!ok) setError("This browser does not support the Web Audio API. Try Chrome, Edge, or Firefox.");
    else log("system", "Audio engine unlocked on user gesture.");
  };

  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const [, meta, b64] = dataUrl.match(/^data:(.*?);base64,(.*)$/) || [];
      if (b64) setImageData({ base64: b64, mediaType: meta, name: file.name });
    };
    reader.onerror = () => setError("Could not read the uploaded image.");
    reader.readAsDataURL(file);
  };

  function applyPlan(planBounds, planTempo, planNodes, sourceLabel) {
    setBounds(planBounds);
    setTempo(Math.max(0.25, Math.min(3, planTempo || 1)));
    setNodes(planNodes);
    setCurrentIndex(-1);
    log("plan", `${sourceLabel}: ${planNodes.length} node(s) ready.`);
  }

  async function runAgent() {
    setLoading(true);
    setError(null);
    setTelemetry([]);
    log("agent", "Planner/critic phase started.");

    let userContent;
    let sourceLabel;
    if (inputMode === "image" && imageData) {
      userContent = [
        { type: "image", source: { type: "base64", media_type: imageData.mediaType, data: imageData.base64 } },
        { type: "text", text: "Analyze this chart or diagram image and build a sonification plan." },
      ];
      sourceLabel = `Image: ${imageData.name}`;
    } else if (inputMode === "preset") {
      userContent = [{ type: "text", text: PRESETS[presetKey].text }];
      sourceLabel = PRESETS[presetKey].label;
    } else {
      const text = freeText.trim();
      if (!text) {
        setError("Enter some code or data text first.");
        setLoading(false);
        return;
      }
      userContent = [{ type: "text", text: `Build a sonification plan for:\n\n${text}` }];
      sourceLabel = "Custom text input";
    }

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          system: SYSTEM_PROMPT,
          tools: TOOLS,
          tool_choice: { type: "any" },
          messages: [{ role: "user", content: userContent }],
        }),
      });
      if (!res.ok) throw new Error(`API request failed (${res.status})`);
      const data = await res.json();

      let planBounds = { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
      let planTempo = 1;
      const planNodes = [];
      let pending = null;

      // Collect real tool_use blocks; if none exist, fall back to parsing
      // pseudo-code the model may have written as plain text.
      let toolBlocks = (data.content || []).filter((b) => b.type === "tool_use");
      const textBlocks = (data.content || []).filter((b) => b.type === "text" && b.text?.trim());
      textBlocks.forEach((b) => log("reasoning", b.text.trim()));
      if (toolBlocks.length === 0 && textBlocks.length > 0) {
        const recovered = textBlocks.flatMap((b) => extractPseudoToolCalls(b.text));
        if (recovered.length > 0) {
          log("system", `Recovered ${recovered.length} tool call(s) from text output.`);
          toolBlocks = recovered.map((c) => ({ type: "tool_use", name: c.name, input: c.input }));
        }
      }

      for (const block of toolBlocks) {
        log("tool", `${block.name}(${JSON.stringify(block.input)})`);
        const inp = block.input || {};
        if (block.name === "defineSpatialBounds") {
          planBounds = {
            xMin: getField(inp, "xMin", "minValue", "min") ?? 0,
            xMax: getField(inp, "xMax", "maxValue", "max") ?? 1,
            yMin: getField(inp, "yMin", "minFrequencyHz", "minValue") ?? 0,
            yMax: getField(inp, "yMax", "maxFrequencyHz", "maxValue") ?? 1,
          };
        } else if (block.name === "setPlaybackTempo") {
          planTempo = getField(inp, "bpmMultiplier", "bpm", "tempo") ?? 1;
          if (planTempo > 4) planTempo = planTempo / 80; // model gave raw BPM, not a multiplier
        } else if (block.name === "scheduleTone") {
          if (pending) planNodes.push(pending);
          pending = {
            frequencyHz: getField(inp, "frequencyHz", "frequency") ?? 440,
            stereoPan: getField(inp, "stereoPan", "pan") ?? 0,
            durationSec: getField(inp, "durationSec", "duration") ?? 0.4,
            timberType: getField(inp, "timberType", "timbre", "waveform") ?? "sine",
            textLabel: null,
          };
        } else if (block.name === "scheduleSpeechMarker") {
          const label = getField(inp, "textLabel", "label", "text");
          if (pending && !pending.textLabel) {
            pending.textLabel = label;
          } else {
            planNodes.push({ frequencyHz: 440, stereoPan: 0, durationSec: 0.3, timberType: "sine", textLabel: label });
          }
        }
      }
      if (pending) planNodes.push(pending);

      if (planNodes.length === 0) throw new Error("Agent returned no schedulable nodes.");
      applyPlan(planBounds, planTempo, planNodes, sourceLabel);
      log("agent", "Plan accepted. Ready for playback.");
    } catch (e) {
      log("error", `Live agent unavailable (${e.message}). Falling back to offline planner.`);
      const key = inputMode === "preset" ? presetKey : "bubblesort";
      const fp = localPlan(key);
      applyPlan(fp.bounds, fp.tempo, fp.nodes, `Offline fallback: ${PRESETS[key].label}`);
      setError(`Live agent unavailable — showing an offline demo plan instead. (${e.message})`);
    } finally {
      setLoading(false);
    }
  }

  const playNode = useCallback((idx) => {
    const node = nodes[idx];
    if (!node || !engineRef.current.unlocked) return;
    const freq = engineRef.current.playTone(node);
    engineRef.current.speak(node.textLabel || `Node ${idx + 1}`);
    setLiveMsg(`Node ${idx + 1} of ${nodes.length}. ${node.textLabel || ""} Tone ${Math.round(freq || node.frequencyHz)} hertz.`);
  }, [nodes]);

  const stepTo = useCallback((idx) => {
    if (idx < 0 || idx >= nodes.length) return;
    setIsPlaying(false);
    clearTimeout(timeoutRef.current);
    setCurrentIndex(idx);
    playNode(idx);
  }, [nodes, playNode]);

  // continuous playback driver
  useEffect(() => {
    if (!isPlaying) return;
    if (currentIndex < 0) {
      setCurrentIndex(0);
      return;
    }
    if (currentIndex >= nodes.length) {
      setIsPlaying(false);
      return;
    }
    playNode(currentIndex);
    const node = nodes[currentIndex];
    const gapMs = ((node?.durationSec || 0.4) + 0.18) * 1000 / tempo;
    timeoutRef.current = setTimeout(() => setCurrentIndex((i) => i + 1), gapMs);
    return () => clearTimeout(timeoutRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, currentIndex]);

  const togglePlay = useCallback(() => {
    if (!engineRef.current.unlocked || nodes.length === 0) return;
    setIsPlaying((p) => !p);
  }, [nodes]);

  const adjustTempo = useCallback((delta) => {
    setTempo((t) => Math.max(0.25, Math.min(3, Math.round((t + delta) * 100) / 100)));
  }, []);

  // global keyboard shortcuts
  useEffect(() => {
    function onKey(e) {
      const tag = e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.code === "Space") { e.preventDefault(); togglePlay(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); stepTo(Math.min(nodes.length - 1, currentIndex + 1)); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); stepTo(Math.max(0, currentIndex - 1)); }
      else if (e.key === "[") { adjustTempo(-0.1); }
      else if (e.key === "]") { adjustTempo(0.1); }
      else if (e.key === "r" || e.key === "R") { if (currentIndex >= 0) playNode(currentIndex); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, stepTo, adjustTempo, currentIndex, nodes, playNode]);

  const canvasW = 640, canvasH = 220;
  const mapX = (pan) => 40 + ((pan + 1) / 2) * (canvasW - 80);
  const mapY = (freq) => {
    const lo = 220, hi = 1760;
    const t = Math.max(0, Math.min(1, (freq - lo) / (hi - lo)));
    return canvasH - 30 - t * (canvasH - 60);
  };
  const timbreColor = { sine: "var(--accent)", triangle: "var(--accent2)", sawtooth: "var(--warn)", square: "var(--muted2)" };

  const pathD = nodes.length > 1
    ? "M " + nodes.map((n) => `${mapX(n.stereoPan)},${mapY(quantizeFrequency(n.frequencyHz))}`).join(" L ")
    : "";

  return (
    <div className="at-root">
      <style>{`
        .at-root {
          --bg: #08080d; --surface: #121219; --surface2: #191a24;
          --text: #f2f1f6; --muted: #8b8a9a; --muted2: #55536b;
          --accent: #7c5cff; --accent2: #45c2ff; --warn: #ff8a45;
          --ok: #37e29a; --border: #24242f;
          background: var(--bg); color: var(--text); min-height: 100vh;
          font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
          padding: 24px; box-sizing: border-box;
        }
        .at-root * { box-sizing: border-box; }
        .at-head { display:flex; align-items:baseline; gap:12px; margin-bottom:4px; flex-wrap:wrap; }
        .at-title { font-family: "Space Grotesk", -apple-system, sans-serif; font-size: 26px; font-weight: 700; letter-spacing:-0.01em; }
        .at-sub { color: var(--muted); font-size: 13px; }
        .at-grid { display:grid; grid-template-columns: 340px 1fr; gap:18px; margin-top:22px; }
        @media (max-width: 900px) { .at-grid { grid-template-columns: 1fr; } }
        .at-panel { background: var(--surface); border:1px solid var(--border); border-radius:12px; padding:16px; }
        .at-panel + .at-panel { margin-top:16px; }
        .at-label { font-size:11px; text-transform:uppercase; letter-spacing:0.08em; color:var(--muted); margin-bottom:8px; display:block; }
        .at-tabs { display:flex; gap:6px; margin-bottom:12px; }
        .at-tab { flex:1; background:var(--surface2); border:1px solid var(--border); color:var(--muted); padding:8px 6px; border-radius:8px; font-size:12.5px; cursor:pointer; }
        .at-tab[aria-selected="true"] { color:var(--text); border-color:var(--accent); background: color-mix(in srgb, var(--accent) 16%, var(--surface2)); }
        .at-tab:focus-visible, button:focus-visible, select:focus-visible, textarea:focus-visible, input:focus-visible {
          outline: 3px solid var(--accent2); outline-offset: 2px;
        }
        select, textarea, .at-file {
          width:100%; background:var(--surface2); color:var(--text); border:1px solid var(--border);
          border-radius:8px; padding:10px; font-size:13.5px; font-family:inherit;
        }
        textarea { min-height:96px; resize:vertical; }
        .at-btn {
          background: var(--accent); color:#fff; border:none; border-radius:9px;
          padding:11px 14px; font-size:14px; font-weight:600; cursor:pointer;
          display:flex; align-items:center; justify-content:center; gap:8px; width:100%;
        }
        .at-btn:disabled { opacity:0.5; cursor:not-allowed; }
        .at-btn.ghost { background:transparent; border:1px solid var(--border); color:var(--text); }
        .at-error { background: color-mix(in srgb, var(--warn) 14%, var(--surface)); border:1px solid var(--warn); color:#ffd7bd; border-radius:9px; padding:10px 12px; font-size:12.5px; margin-top:10px; display:flex; gap:8px; }
        .at-canvas-wrap { position:relative; }
        .at-transport { display:flex; align-items:center; gap:10px; margin-top:14px; flex-wrap:wrap; }
        .at-iconbtn { background:var(--surface2); border:1px solid var(--border); color:var(--text); width:42px; height:42px; border-radius:50%; display:flex; align-items:center; justify-content:center; cursor:pointer; }
        .at-iconbtn:disabled { opacity:0.4; cursor:not-allowed; }
        .at-tempo { display:flex; align-items:center; gap:8px; margin-left:auto; color:var(--muted); font-size:12.5px; font-family: ui-monospace, Menlo, monospace; }
        .at-keys { color:var(--muted); font-size:11.5px; margin-top:10px; font-family: ui-monospace, Menlo, monospace; }
        .at-keys kbd { background:var(--surface2); border:1px solid var(--border); border-radius:4px; padding:1px 6px; margin:0 2px; }
        .at-nodelist { list-style:none; padding:0; margin:14px 0 0; max-height:180px; overflow:auto; }
        .at-nodelist li { padding:8px 10px; border-radius:8px; font-size:12.5px; color:var(--muted); display:flex; gap:8px; align-items:center; cursor:pointer; }
        .at-nodelist li.active { background: color-mix(in srgb, var(--accent) 18%, transparent); color:var(--text); }
        .at-dot { width:9px; height:9px; border-radius:50%; flex:none; }
        .at-tele { background:#000; border:1px solid var(--border); border-radius:10px; padding:10px 12px; height:220px; overflow:auto; font-family: ui-monospace, Menlo, Consolas, monospace; font-size:11.8px; }
        .at-tele-row { padding:3px 0; border-bottom:1px solid #17171f; display:flex; gap:8px; }
        .at-tele-kind { flex:none; width:76px; text-transform:uppercase; font-size:10px; letter-spacing:0.04em; }
        .k-plan{color:var(--ok)} .k-tool{color:var(--accent2)} .k-reasoning{color:var(--muted)} .k-error{color:var(--warn)} .k-agent{color:var(--accent)} .k-system{color:var(--muted2)}
        .sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
        .at-gate { display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; gap:14px; padding:60px 20px; }
      `}</style>

      <div className="at-head">
        <span className="at-title">AudioTutor‑Agent</span>
        <span className="at-sub">Multimodal agentic sonification for blind &amp; low‑vision STEM learners</span>
      </div>

      <div aria-live="assertive" className="sr-only">{liveMsg}</div>

      {!audioReady ? (
        <div className="at-panel at-gate" style={{ marginTop: 22 }}>
          <Volume2 size={30} color="var(--accent)" aria-hidden="true" />
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Enable audio to begin</div>
            <div className="at-sub">Browsers require a user gesture before playing sound.</div>
          </div>
          <button className="at-btn" style={{ width: 220 }} onClick={enableAudio}>
            <Volume2 size={16} aria-hidden="true" /> Enable audio &amp; start
          </button>
          {error && <div className="at-error"><AlertTriangle size={15} aria-hidden="true" /> {error}</div>}
        </div>
      ) : (
        <div className="at-grid">
          {/* LEFT: input engine */}
          <div>
            <div className="at-panel">
              <span className="at-label">1 · Multimodal input</span>
              <div className="at-tabs" role="tablist" aria-label="Input modality">
                {[["preset", "Preset"], ["text", "Text / code"], ["image", "Image"]].map(([k, l]) => (
                  <button key={k} role="tab" aria-selected={inputMode === k} className="at-tab" onClick={() => setInputMode(k)}>{l}</button>
                ))}
              </div>

              {inputMode === "preset" && (
                <select value={presetKey} onChange={(e) => setPresetKey(e.target.value)} aria-label="Choose a preset">
                  {Object.entries(PRESETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              )}
              {inputMode === "text" && (
                <textarea
                  value={freeText}
                  onChange={(e) => setFreeText(e.target.value)}
                  placeholder="Paste code, a numeric array, or describe a chart..."
                  aria-label="Raw text or code input"
                />
              )}
              {inputMode === "image" && (
                <div>
                  <label className="at-file" style={{ display: "block", textAlign: "center", cursor: "pointer" }}>
                    <Upload size={15} aria-hidden="true" style={{ verticalAlign: "-3px", marginRight: 6 }} />
                    {imageData ? imageData.name : "Upload a chart or diagram"}
                    <input type="file" accept="image/*" onChange={handleImageUpload} style={{ display: "none" }} />
                  </label>
                </div>
              )}

              <div style={{ marginTop: 12 }}>
                <button className="at-btn" onClick={runAgent} disabled={loading}>
                  <Sparkles size={16} aria-hidden="true" /> {loading ? "Planning…" : "Generate sonification plan"}
                </button>
              </div>
              {error && <div className="at-error"><AlertTriangle size={15} aria-hidden="true" /> {error}</div>}
            </div>

            <div className="at-panel">
              <span className="at-label">Telemetry &amp; agent trace</span>
              <div className="at-tele" role="log" aria-label="Agent telemetry console">
                {telemetry.length === 0 && <div style={{ color: "var(--muted2)" }}>No activity yet.</div>}
                {telemetry.map((row) => (
                  <div key={row.id} className="at-tele-row">
                    <span className={`at-tele-kind k-${row.kind}`}>{row.kind}</span>
                    <span>{row.message}</span>
                  </div>
                ))}
                <div ref={telemetryEndRef} />
              </div>
            </div>
          </div>

          {/* RIGHT: canvas + transport + nodes */}
          <div className="at-panel">
            <span className="at-label">2 · Accessible audio canvas</span>
            <div className="at-canvas-wrap">
              <svg viewBox={`0 0 ${canvasW} ${canvasH}`} width="100%" height={canvasH} role="img" aria-hidden="true">
                <line x1={40} y1={canvasH - 20} x2={canvasW - 40} y2={canvasH - 20} stroke="var(--border)" strokeWidth="1" />
                {pathD && <path d={pathD} stroke="var(--muted2)" strokeWidth="1.4" fill="none" opacity="0.6" />}
                {nodes.map((n, i) => {
                  const x = mapX(n.stereoPan), y = mapY(quantizeFrequency(n.frequencyHz));
                  const active = i === currentIndex;
                  return (
                    <g key={i}>
                      <circle cx={x} cy={y} r={active ? 10 : 6} fill={timbreColor[n.timberType] || "var(--accent)"} opacity={active ? 1 : 0.75}>
                        {active && <animate attributeName="r" values="8;12;8" dur="0.6s" repeatCount="indefinite" />}
                      </circle>
                      <text x={x} y={canvasH - 6} fontSize="9" fill="var(--muted2)" textAnchor="middle">{i + 1}</text>
                    </g>
                  );
                })}
                {nodes.length === 0 && (
                  <text x={canvasW / 2} y={canvasH / 2} textAnchor="middle" fill="var(--muted2)" fontSize="13">
                    Generate a plan to populate the acoustic canvas
                  </text>
                )}
              </svg>
              {bounds && (
                <div className="at-sub" style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11 }}>
                  x: [{Number(bounds.xMin).toFixed(1)}, {Number(bounds.xMax).toFixed(1)}] · y: [{Number(bounds.yMin).toFixed(1)}, {Number(bounds.yMax).toFixed(1)}] · left→right pan, low→high pitch
                </div>
              )}
            </div>

            <div className="at-transport">
              <button className="at-iconbtn" onClick={() => stepTo(currentIndex - 1)} disabled={nodes.length === 0} aria-label="Previous node"><SkipBack size={17} /></button>
              <button className="at-iconbtn" onClick={togglePlay} disabled={nodes.length === 0} aria-label={isPlaying ? "Pause" : "Play"}>
                {isPlaying ? <Pause size={18} /> : <Play size={18} />}
              </button>
              <button className="at-iconbtn" onClick={() => stepTo(currentIndex + 1)} disabled={nodes.length === 0} aria-label="Next node"><SkipForward size={17} /></button>
              <button className="at-iconbtn" onClick={() => currentIndex >= 0 && playNode(currentIndex)} disabled={currentIndex < 0} aria-label="Repeat current node"><RotateCcw size={16} /></button>
              <div className="at-tempo"><Activity size={13} aria-hidden="true" /> tempo ×{tempo.toFixed(2)}</div>
            </div>
            <div className="at-keys">
              <kbd>Space</kbd> play/pause · <kbd>←</kbd><kbd>→</kbd> step · <kbd>[</kbd><kbd>]</kbd> tempo · <kbd>R</kbd> repeat
            </div>

            <span className="at-label" style={{ marginTop: 16, display: "block" }}>Node sequence</span>
            <ul className="at-nodelist" aria-label="Sonification node sequence">
              {nodes.map((n, i) => (
                <li key={i} className={i === currentIndex ? "active" : ""} onClick={() => stepTo(i)}>
                  <span className="at-dot" style={{ background: timbreColor[n.timberType] || "var(--accent)" }} />
                  <span style={{ flex: "none", color: "var(--muted2)" }}>{i + 1}.</span>
                  <span>{n.textLabel || `Tone ${Math.round(n.frequencyHz)} Hz`}</span>
                  {i === currentIndex && <ChevronRight size={13} style={{ marginLeft: "auto" }} aria-hidden="true" />}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
