import * as stream from 'stream';
import zlib from 'zlib';
import { BodyReader, HTTPReq, HTTPRes } from "../../custom_types";
import { fieldGet } from "../buffer";

function gzipFilter(reader: BodyReader): BodyReader {
    const gz: stream.Duplex = zlib.createGzip()
    return {
        length: -1,
        read: async (): Promise<Buffer> => {
            const data = await reader.read()
            await write_input(gz, data)
            return await read_output(gz)
        }
    }
}

function enableCompression(req: HTTPReq, res: HTTPRes): void {
    // inform the proxy that response is variable
    res.headers.push(Buffer.from('Vary: content-encoding'))
    /* 
    HTTP compression typically does not work with ranged requests because compression alters
    byte positions, making it difficult to serve a specific byte range from the compressed content.
    */
    if (fieldGet(req.headers, 'Range'))
        return  // incompatible with ranged requests

    const codecs: string[] = fieldGetList(req.headers, 'Accept-Encoding')
    if (!codecs.includes('gzip'))
        return
    res.headers.push(Buffer.from('Content-Encoding: gzip'))
    res.body = gzipFilter(res.body)
}

