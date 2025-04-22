import * as stream from 'stream';
import * as zlib from 'zlib';
import { BodyReader, HTTPReq, HTTPRes } from "../../custom_types";
import { fieldGet, fieldGetList } from "../buffer";
import { pipeline } from "stream/promises"

function body2stream(reader: BodyReader): stream.Readable {
    let self: null | stream.Readable = null
    self = new stream.Readable({
        read: async () => {
            try {
                /* read chunk and push it to the internal buffer
                for the writable stream(consumer) to consume */
                const data: Buffer = await reader.read()
                self!.push(data.length > 0 ? data : null)
            } catch (err) {
                self!.destroy(err instanceof Error ? err : new Error('IO'))
            }
        }
    })
    return self
}

function gzipFilter(reader: BodyReader): BodyReader {
    const gz: stream.Duplex = zlib.createGzip({ flush: zlib.constants.Z_SYNC_FLUSH })
    const input: stream.Readable = body2stream(reader);
    (async () => {
        try { await pipeline(input, gz) }
        catch (err) { gz.destroy(err) }
    })()

    /*
    const iter = async function* (stream: stream.Readable): AsyncGenerator<Buffer> {
        for await (const chunk of stream) {
            yield chunk as Buffer;
        }
    }(gz);
    const iter: AsyncIterator<Buffer> = gz.iterator()
    */

    // TODO: read about AsyncGenerator
    const iter = async function* (): AsyncGenerator<Buffer> {
        for await (const chunk of gz) {
            yield chunk as Buffer;
        }
    }();
    return {
        length: -1,
        read: async (): Promise<Buffer> => {
            const r: IteratorResult<Buffer> = await iter.next()
            return r.done ? Buffer.from('') : r.value
        },
        close: reader.close
    }
}

function enableCompression(req: HTTPReq, res: HTTPRes): void {
    // inform the proxy that response is variable
    res.headers.push(Buffer.from('Vary: content-encoding'))
    /* HTTP compression typically does not work with ranged requests because compression alters
    byte positions, making it difficult to serve a specific byte range from the compressed content. */
    if (fieldGet(req.headers, 'Range'))
        return  // incompatible with ranged requests

    const codecs: string[] = fieldGetList(req.headers, 'Accept-Encoding')
    if (!codecs.includes('gzip'))
        return
    res.headers.push(Buffer.from('Content-Encoding: gzip'))
    res.body = gzipFilter(res.body)
}

export { enableCompression }