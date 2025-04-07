import { HTTPReq } from "../../custom_types";
import { splitLines, parseRequestLine, validateHeader } from "../buffer";

class HTTPError extends Error {
    constructor(public code: number, message: string) {
        super(message);
        this.name = "HTTPError";
    }
}

function parseHTTPReq(data: Buffer): HTTPReq {
    // console.log(data.toString());
    const lines: Buffer[] = splitLines(data)

    // lines.forEach(line => console.log("[", line.toString(), "]"))

    const [method, uri, version] = parseRequestLine(lines[0])

    const headers: Buffer[] = []
    for (let i = 1; i < lines.length; i++) {
        const h = Buffer.from(lines[i])
        if (!validateHeader(h)) {
            throw new HTTPError(400, 'bad field')
        }
        headers.push(h)
    }

    // console.log("Assertion of parseHTTPReq")
    // console.assert(lines[lines.length - 1].length === 0)
    return { method, uri, version, headers }
}

export { HTTPError, parseHTTPReq }