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

async function serveStaticFile(path: string, start: number = 0, end: number = 0): Promise<HTTPRes> {
    let fp: null | fs.FileHandle = null;
    try {
        // open the file
        fp = await fs.open(path, 'r');  // 'r' means read-only mode
        // get the stat and check if it's a file
        const stat = await fp.stat()
        if (!stat.isFile())
            return { code: 404, headers: [], body: readerFromMemory(Buffer.from('Not a file!\n')) }
        return staticFileRes(fp, start, end)
    } catch (exec) {
        console.info('error serving file: ', exec)
        return { code: 404, headers: [], body: readerFromMemory(Buffer.from('No such file found!\n')) }
    } finally {
        // make sure the file is closed
        fp = null
        // await fp?.close()
    }
}

function readerFromStaticFile(fp: fs.FileHandle, start: number, end: number): BodyReader {
    const buf = Buffer.allocUnsafe(65536)
    let got = 0
    return {
        length: end - start + 1,
        read: async (): Promise<Buffer> => {
            const maxread = Math.min(buf.length, end - start + 1)
            const r: fs.FileReadResult<Buffer> = await fp.read({
                buffer: buf, position: start + 1, length: maxread
            })
            got += r.bytesRead
            // if (got > size || (got < size && r.bytesRead === 0)) {
            //     // unhappy case: file size changed
            //     // cannot continue since we have sent the 'Content-Length'
            //     throw new Error('file size changed, abandon it!')
            // }
            // NOTE: the automatically allocated buffer may be larger
            return r.buffer.subarray(0, r.bytesRead)
        },
        close: async () => await fp.close(),
    }
}

function staticFileRes(fp: fs.FileHandle, start: number, end: number): HTTPRes {
    return { code: 206, headers: [], body: readerFromStaticFile(fp, start, end) }
}

export {
    serveStaticFile,
    readerFromStaticFile
}