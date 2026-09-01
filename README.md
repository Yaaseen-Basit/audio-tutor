# AudioTutor-Agent: Multimodal Agentic Sonification for STEM Accessibility

> An interactive research prototype exploring how agentic tool-calling, real-time Web Audio synthesis, and accessible interaction design can translate visual and algorithmic STEM representations into spatialized audio experiences for blind and low-vision learners.

---

## 🎯 Research Motivation & Vision

Standard STEM educational materials rely heavily on visual cues:
- Algorithm traces (e.g., sorting, pointer swaps)
- 2D charts and data distributions
- Non-linear mathematical functions
- Hierarchical data structures (trees, graphs)

Screen readers typically read these representations linearly as text, losing structural context and spatial progression. **AudioTutor-Agent** explores a dual-modality interaction loop:
$$\text{Visual/Text STEM Input} \longrightarrow \text{Agentic Semantic Planner} \longrightarrow \text{Constrained Tool Calls} \longrightarrow \text{Spatial Web Audio DSP + Speech Cues}$$

---

## ⚡ Core Features

- **Agentic Semantic Planning:** Utilizes multimodal foundation models (`claude-sonnet-4-6`) to deconstruct arbitrary code, numerical arrays, and chart images into structured, sequential sonification plans.
- **Zero-Asset Real-Time Web Audio DSP:** Pure mathematical audio synthesis using the browser's native Web Audio API (`OscillatorNode`, `StereoPannerNode`, `BiquadFilterNode`, ADSR gain envelopes). Zero pre-recorded samples.
- **Harmonic Quantization:** Maps numerical data values to an A-minor pentatonic scale (220 Hz – 1760 Hz) to eliminate acoustic dissonance during continuous playback.
- **Multi-Parameter Acoustic Mapping:**
  - **Pitch ($\text{Hz}$):** Magnitude / Data Value
  - **Stereo Pan ($-1.0 \text{ to } +1.0$):** Horizontal spatial position / Sequence progression
  - **Timbre (Waveform + Cutoff Filter):** Semantic node role (`sine` = base/normal, `triangle` = branch/child, `sawtooth` = anomaly/swap, `square` = pivot/comparison)
  - **Speech Synthesis:** Synchronized screen-reader spoken descriptors.
- **Non-Visual Accessible Interaction:** Comprehensive keyboard navigation (`Space`, `←/→`, `[ / ]`, `R`), transport controls, and `aria-live` assertive accessibility announcements.
- **Fault-Tolerant Execution:** Features a regex-based recovery engine for malformed tool outputs and a deterministic offline fallback planner for network-resilient user studies.

---

## 🏗️ System Architecture

```text
               +--------------------------------------+
               |           Multimodal Input           |
               |  (Presets / Free Text / Chart Image) |
               +--------------------------------------+
                                  |
                                  v
               +--------------------------------------+
               |    Semantic Planner / Tool Caller    |
               |                  |
               +--------------------------------------+
                                  |
                   [Constrained Tool Call Stream]
                                  |
                 +----------------+----------------+
                 |                                 |
                 v                                 v
   +---------------------------+     +---------------------------+
   |  `defineSpatialBounds()`  |     |     `scheduleTone()`      |
   |   `setPlaybackTempo()`    |     | `scheduleSpeechMarker()`  |
   +---------------------------+     +---------------------------+
                 |                                 |
                 +----------------+----------------+
                                  |
                                  v
               +--------------------------------------+
               |      Plan Normalization Engine       |
               | (Schema Validator & AST Text Recovery)|
               +--------------------------------------+
                                  |
                                  v
               +--------------------------------------+
               |          Execution Layer             |
               +------------------+-------------------+
                                  |
                 +----------------+----------------+
                 |                                 |
                 v                                 v
     +-----------------------+         +-----------------------+
     |   Web Audio API DSP   |         | SpeechSynthesis Engine|
     | (Oscillator / Panner) |         | (Aria-live Cues)      |
     +-----------------------+         +-----------------------+

## 🛠️ Tool Schema Specification

The agent communicates with the browser frontend strictly via structured tool invocations:

| Tool | Parameters | Description |
| :--- | :--- | :--- |
| `defineSpatialBounds` | `xMin`, `xMax`, `yMin`, `yMax` | Calibrates the virtual bounding box for spatial mapping. |
| `setPlaybackTempo` | `bpmMultiplier` | Controls timeline execution and relative note duration. |
| `scheduleTone` | `frequencyHz`, `stereoPan`, `durationSec`, `timberType` | Emits a synthesized tone with frequency, panning, and timbre properties. |
| `scheduleSpeechMarker` | `textLabel`, `delayOffsetSec` | Triggers a concise screen-reader audio cue synchronized with the active node. |

---

## ⌨️ Accessibility & Keyboard Shortcuts

| Key | Action |
| :--- | :--- |
| `Space` | Play / Pause continuous playback |
| `←` / `→` | Step backward / forward one node |
| `[` / `]` | Decrease / Increase playback tempo |
| `R` | Replay current node audio and speech cue |

     # Clone the repository
git clone [https://github.com/Yaaseen-Basit/audio-tutor-agent.git](https://github.com/Yaaseen-Basit/audio-tutor-agent.git)
cd audio-tutor-agent

# Install dependencies
npm install

# Start development server
npm run dev
Research & Future Directions
Integration of interactive multi-agent dialogue loops for exploratory STEM debugging.

Real-time gesture-based scrubbing and tactile haptic feedback pairing.

Longitudinal user studies with visually impaired participants across algorithmic learning tasks.