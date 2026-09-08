export interface SseMessage {
  event?: string;
  data: string;
  id?: string;
}

/** Incremental UTF-8/SSE parser supporting split code points, CRLF, comments and multiline data. */
export async function* parseSse(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SseMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event: string | undefined;
  let id: string | undefined;
  let data: string[] = [];

  const consumeLine = (line: string): SseMessage | undefined => {
    if (line === "") {
      if (data.length === 0) {
        event = undefined;
        return undefined;
      }
      const message = { event, data: data.join("\n"), id };
      event = undefined;
      data = [];
      return message;
    }
    if (line.startsWith(":")) return undefined;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
    else if (field === "id" && !value.includes("\0")) id = value;
    return undefined;
  };

  try {
    while (true) {
      if (signal?.aborted)
        throw new DOMException("The operation was aborted", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.search(/[\r\n]/)) >= 0) {
        const line = buffer.slice(0, newline);
        const terminator = buffer[newline];
        buffer = buffer.slice(newline + 1);
        if (terminator === "\r" && buffer.startsWith("\n"))
          buffer = buffer.slice(1);
        const message = consumeLine(line);
        if (message) yield message;
      }
    }
    buffer += decoder.decode();
    if (buffer) {
      const message = consumeLine(buffer);
      if (message) yield message;
    }
    const finalMessage = consumeLine("");
    if (finalMessage) yield finalMessage;
  } finally {
    reader.releaseLock();
  }
}
