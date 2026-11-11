import type { Turn } from "../shared/types";

export type GuideStatus = "connecting" | "listening" | "hearing" | "thinking" | "speaking" | "ended" | "error";

type Listener = {
  onStatus(status: GuideStatus): void;
  onTurns(turns: Turn[]): void;
  onFinish(): void;
  onError(message: string): void;
};

type Entry = { id: string; role: Turn["role"]; text: string };

/**
 * One live conversation with the guide over WebRTC. Audio travels on media
 * tracks, events on a data channel. The browser only ever holds a short-lived
 * client secret, never the API key.
 */
export class GuideConnection {
  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private stream: MediaStream | null = null;
  private entries: Entry[] = [];
  private speaking = false;
  private wrappingUp = false;
  private finished = false;
  private timers: number[] = [];
  readonly audio = new Audio();

  constructor(private listener: Listener) {
    this.audio.autoplay = true;
  }

  /** Returns false if the microphone was requested but not available. */
  async start(clientSecret: string, useMicrophone: boolean): Promise<boolean> {
    this.listener.onStatus("connecting");
    let micOk = false;
    const pc = new RTCPeerConnection();
    this.pc = pc;
    pc.ontrack = (event) => {
      this.audio.srcObject = event.streams[0];
    };
    pc.onconnectionstatechange = () => {
      if ((pc.connectionState === "failed" || pc.connectionState === "disconnected") && !this.finished) {
        this.listener.onError("The connection dropped. What you said so far is kept. You can review it or reconnect.");
        this.listener.onStatus("error");
      }
    };

    if (useMicrophone && navigator.mediaDevices?.getUserMedia) {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        for (const track of this.stream.getTracks()) pc.addTrack(track, this.stream);
        micOk = true;
      } catch {
        micOk = false;
      }
    }
    if (!micOk) pc.addTransceiver("audio", { direction: "recvonly" });

    const channel = pc.createDataChannel("oai-events");
    this.channel = channel;
    channel.onmessage = (event) => this.handle(JSON.parse(event.data as string) as Record<string, unknown>);
    channel.onopen = () => {
      this.listener.onStatus("thinking");
      this.send({ type: "response.create" }); // The guide speaks first.
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const response = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: { authorization: `Bearer ${clientSecret}`, "content-type": "application/sdp" },
      body: offer.sdp,
    });
    if (!response.ok) throw new Error("The listening guide could not be reached.");
    await pc.setRemoteDescription({ type: "answer", sdp: await response.text() });
    return micOk;
  }

  sendText(text: string): void {
    this.send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } });
    this.send({ type: "response.create" });
  }

  setMicrophoneMuted(muted: boolean): void {
    for (const track of this.stream?.getAudioTracks() || []) track.enabled = !muted;
  }

  turns(): Turn[] {
    return this.entries.filter((entry) => entry.text.trim()).map(({ role, text }) => ({ role, text: text.trim() }));
  }

  stop(): void {
    this.finished = true;
    for (const timer of this.timers) window.clearTimeout(timer);
    this.channel?.close();
    for (const track of this.stream?.getTracks() || []) track.stop();
    this.pc?.close();
    this.audio.pause();
    this.audio.srcObject = null;
    this.pc = null;
    this.channel = null;
    this.stream = null;
  }

  private send(event: object): void {
    if (this.channel?.readyState === "open") this.channel.send(JSON.stringify(event));
  }

  private entry(id: string, role: Turn["role"]): Entry {
    let found = this.entries.find((item) => item.id === id);
    if (!found) {
      found = { id, role, text: "" };
      this.entries.push(found);
    }
    return found;
  }

  private publish(): void {
    this.listener.onTurns(this.turns());
  }

  private finish(delay: number): void {
    if (this.finished) return;
    this.timers.push(
      window.setTimeout(() => {
        if (this.finished) return;
        this.finished = true;
        this.listener.onStatus("ended");
        this.listener.onFinish();
      }, delay),
    );
  }

  private handle(event: Record<string, unknown>): void {
    const type = String(event.type || "");
    const itemId = typeof event.item_id === "string" ? event.item_id : "";
    const item = (event.item || null) as { id?: string; type?: string; role?: string; name?: string; content?: { type?: string; text?: string }[] } | null;

    switch (type) {
      // Items are registered when created so the transcript keeps conversation order
      // even though the participant's transcription arrives after the guide starts replying.
      case "conversation.item.added":
      case "conversation.item.created":
        if (item?.id && item.type === "message" && (item.role === "user" || item.role === "assistant")) {
          const entry = this.entry(item.id, item.role === "user" ? "participant" : "guide");
          const typed = item.content?.find((part) => part.type === "input_text")?.text;
          if (typed) entry.text = typed;
          this.publish();
        }
        break;
      case "conversation.item.input_audio_transcription.delta":
        if (itemId) this.entry(itemId, "participant").text += String(event.delta || "");
        this.publish();
        break;
      case "conversation.item.input_audio_transcription.completed":
        if (itemId) this.entry(itemId, "participant").text = String(event.transcript || "");
        this.publish();
        break;
      case "response.output_audio_transcript.delta":
      case "response.audio_transcript.delta":
      case "response.output_text.delta":
        if (itemId) this.entry(itemId, "guide").text += String(event.delta || "");
        this.publish();
        break;
      case "response.output_audio_transcript.done":
      case "response.audio_transcript.done":
        if (itemId && typeof event.transcript === "string") this.entry(itemId, "guide").text = event.transcript;
        this.publish();
        break;
      case "input_audio_buffer.speech_started":
        this.listener.onStatus("hearing");
        break;
      case "input_audio_buffer.speech_stopped":
        this.listener.onStatus("thinking");
        break;
      case "output_audio_buffer.started":
        this.speaking = true;
        this.listener.onStatus("speaking");
        break;
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared":
        this.speaking = false;
        if (this.wrappingUp) this.finish(700);
        else this.listener.onStatus("listening");
        break;
      case "response.output_item.done":
        if (item?.type === "function_call" && item.name === "finish_conversation") {
          this.wrappingUp = true;
          // Let the closing sentence finish playing before moving on.
          this.finish(this.speaking ? 15000 : 2500);
        }
        break;
      case "error": {
        const detail = (event.error || {}) as { message?: string };
        console.warn("Guide event error", detail.message);
        break;
      }
    }
  }
}
