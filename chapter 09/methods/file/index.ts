import * as fs from "fs/promises"
import { BodyReader, HTTPRes } from "../../custom_types";

function readerFromMemory(data: Buffer): BodyReader {
    let done = false;
    return {
        length: data.length,
        read: async (): Promise<Buffer> => {
            if (done) {
                return Buffer.from(''); // no more data
            } else {
                done = true;
                return data;
            }
        },
    }
}

async function serveStaticFile(path: string): Promise<HTTPRes> {
    let fp: null | fs.FileHandle = null;
    try {
        // open the file
        fp = await fs.open(path, 'r');  // 'r' means read-only mode
        // get the stat and check if it's a file
        const stat = await fp.stat()
        if (!stat.isFile())
            return { code: 404, headers: [], body: readerFromMemory(Buffer.from('Not a file!\n')) }
        // get the file size
        const size = stat.size
        const reader: BodyReader = readerFromStaticFile(fp, size)
        fp = null
        return { code: 200, headers: [], body: reader }
    } catch (exec) {
        console.info('error serving file: ', exec)
        return { code: 404, headers: [], body: readerFromMemory(Buffer.from('No such file found!\n')) }
    } finally {
        // make sure the file is closed
        await fp?.close()
    }
}

function readerFromStaticFile(fp: fs.FileHandle, size: number): BodyReader {
    const buf = Buffer.allocUnsafe(65536)
    let got = 0
    return {
        length: size,
        read: async (): Promise<Buffer> => {
            const r: fs.FileReadResult<Buffer> = await fp.read({ buffer: buf })
            got += r.bytesRead
            if (got > size || (got < size && r.bytesRead === 0)) {
                // unhappy case: file size changed
                // cannot continue since we have sent the 'Content-Length'
                throw new Error('file size changed, abandon it!')
            }
            // NOTE: the automatically allocated buffer may be larger
            return r.buffer.subarray(0, r.bytesRead)
        },
        close: async () => await fp.close(),
    }
}

export {
    serveStaticFile,
    readerFromStaticFile
}