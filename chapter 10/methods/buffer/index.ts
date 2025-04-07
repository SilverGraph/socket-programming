import { DynBuf } from "../../custom_types"

function bufPush(buf: DynBuf, data: Buffer): void {
    const newLen = buf.length + data.length
    if (newLen > buf.data.length) {
        let cap = Math.max(buf.data.length, 32)
        while (cap < newLen) cap *= 2
        const grown = Buffer.alloc(cap)
        buf.data.copy(grown, 0, 0)
        buf.data = grown
    }
    data.copy(buf.data, buf.length, 0)
    buf.length = newLen
}

function bufPop(buf: DynBuf, len: number): void {
    buf.data.copyWithin(0, len, buf.length)
    buf.data.fill(0, buf.length - len, buf.length);
    buf.length -= len
}

function splitLines(data: Buffer): Buffer[] {
    return data.toString().split("\r\n").filter(line => line.length > 0).map(line => Buffer.from(line));
}

function parseRequestLine(data: Buffer): [string, Buffer, string] {
    const [method, uri, version] = data.toString().split(" ");
    return [method, Buffer.from(uri), version];
}

function validateHeader(h: Buffer): boolean {
    const headerStr = h.toString();

    // Ensure there is exactly one colon separating key and value
    const index = headerStr.indexOf(":");
    if (index === -1 || index === 0 || index === headerStr.length - 1) {
        return false; // No colon, empty key, or empty value
    }

    const key = headerStr.substring(0, index).trim();
    const value = headerStr.substring(index + 1).trim();

    // Validate header key (only printable ASCII, no spaces)
    if (!/^[\x21-\x7E]+$/.test(key) || key.includes(" ")) {
        return false;
    }

    // Ensure value is not empty (though some headers allow empty values)
    return value.length > 0;
}

function fieldGet(headers: Buffer[], key: string): Buffer | null {
    for (const header of headers) {
        const headerStr = header.toString();
        const index = headerStr.indexOf(":");
        if (headerStr.substring(0, index).trim() === key) {
            return Buffer.from(headerStr.substring(index + 1).trim());
        }
    }
    return null;
}

export { bufPush, bufPop, fieldGet, parseRequestLine, splitLines, validateHeader }