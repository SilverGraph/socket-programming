import * as net from "net"
import { TCPConn, DynBuf, BodyReader, HTTPReq, HTTPRes, BufferGenerator } from "./custom_types/index"
import { bufPush, bufPop, fieldGet } from "./methods/buffer"
import { HTTPError, parseHTTPReq } from "./methods/http"
import { serveStaticFile } from "./methods/file"

function soInit(socket: net.Socket): TCPConn {
    const conn: TCPConn = {
        socket: socket, err: null, ended: false, reader: null
    }

    socket.on('data', (data: Buffer) => {
        if (!conn.reader) return
        console.assert(conn.reader)
        conn.socket.pause()
        conn.reader!.resolve(data)
        conn.reader = null
    })

    socket.on('error', (err: Error) => {
        conn.err = err
        if (conn.reader) {
            conn.reader.reject(err)
            conn.reader = null
        }
    })

    socket.on('end', () => {
        conn.ended = true
        if (conn.reader) {
            conn.reader.resolve(Buffer.from(''))    // EOF
            conn.reader = null
        }
    })

    return conn
}
function soRead(conn: TCPConn): Promise<Buffer> {
    console.assert(!conn.reader)
    return new Promise((resolve, reject) => {
        if (conn.err) {
            reject(conn.err)
            return
        }
        if (conn.ended) {
            resolve(Buffer.from(''))
            return
        }
        conn.reader = { resolve, reject }
        conn.socket.resume()
    })
}
function soWrite(conn: TCPConn, data: Buffer): Promise<void> {
    console.assert(data.length > 0)
    return new Promise((resolve, reject) => {
        if (conn.err) {
            reject(conn.err)
            return
        }

        conn.socket.write(data, (err?: Error) => {
            if (err) reject(err)
            resolve()
        })
    })
}

// parse and remove header from the beginning of the buffer
const kMaxHeaderLen = 1024 * 8
function cutMessage(buf: DynBuf): null | HTTPReq {
    const idx = buf.data.subarray(0, buf.length).indexOf('\r\n\r\n')
    if (idx < 0) {
        if (buf.length >= kMaxHeaderLen)
            throw new HTTPError(413, 'Header is too large!')
        return null
    }
    const msg = parseHTTPReq(buf.data.subarray(0, idx + 4))
    bufPop(buf, idx + 4)
    return msg
}

// MAIN FUNCTION FOR REQUEST BODY READER
// buf has request body which is parsed here
function readerFromReq(conn: TCPConn, buf: DynBuf, req: HTTPReq): BodyReader {
    let bodyLen = -1
    const contentLen: null | Buffer = fieldGet(req.headers, 'Content-Length')

    if (contentLen) {
        bodyLen = parseInt(contentLen.toString('latin1'))
        if (isNaN(bodyLen))
            throw new HTTPError(400, 'bad content length')
    }
    const bodyAllowed = !(req.method === 'GET' || req.method === 'HEAD')
    const chunked = fieldGet(req.headers, 'Transfer-Encoding')?.equals(Buffer.from('chunked')) || false

    if (!bodyAllowed && (bodyLen > 0 || chunked))
        throw new HTTPError(400, 'HTTP body not allowed for this method')
    if (!bodyAllowed) bodyLen = 0

    if (bodyLen >= 0)
        return readerFromConnLength(conn, buf, bodyLen)
    else if (chunked)
        return readerFromGenerator(readChunks(conn, buf))
    else
        throw new HTTPError(501, 'TODO')
}

// READING BODY FROM CONTENT-LENGTH
// given content-length read the body for the specified length(remian)
function readerFromConnLength(conn: TCPConn, buf: DynBuf, remain: number): BodyReader {
    return {
        length: remain,
        read: async (): Promise<Buffer> => {
            if (remain === 0)
                return Buffer.from('')
            if (buf.length === 0) {
                const data = await soRead(conn)
                bufPush(buf, data)
                if (data.length === 0)
                    throw new HTTPError(400, 'unexpected EOF from HTTP body')
            }
            const consume = Math.min(remain, buf.length)
            remain -= consume

            const data = Buffer.from(buf.data.subarray(0, consume))
            bufPop(buf, consume)
            return data
        }
    }
}
// IF NO BODY WAS INCLUDED IN THE REQUEST
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
// READING BODY FOR CHUNKED ENCODING
function readerFromGenerator(gen: BufferGenerator): BodyReader {
    return {
        length: -1,
        read: async (): Promise<Buffer> => {
            const r: IteratorResult<Buffer> = await gen.next()
            if (r.done)
                return Buffer.from('') // EOF
            else {
                console.assert(r.value.length > 0)
                return r.value
            }
        },
        close: async (): Promise<void> => {
            // force it to `return` so that the `finally` block will execute
            await gen.return()
        }
    }
}

// DECODE CHUNKED ENCODING AND READ BODY ON THE FLY
async function* readChunks(conn: TCPConn, buf: DynBuf): BufferGenerator {
    for (let last = false; !last;) {
        // read chunk size
        const idx = buf.data.subarray(0, buf.length).indexOf('\r\n')
        if (idx < 0) {
            // need more data
            const data = await soRead(conn)
            bufPush(buf, data)
            continue
        }

        // parse chunk size and remove line
        let remain = parseInt(buf.data.subarray(0, idx).toString('latin1'), 16)
        bufPop(buf, idx + 2) // remove chunk size and \r\n

        // is it the last chunk
        last = remain === 0

        // read and yeild the chunk
        while (remain > 0) {
            if (buf.length === 0) {
                // await bufExpectMore(conn, buf, 'chunk data')
                const data = await soRead(conn)
                bufPush(buf, data)
                if (data.length === 0)
                    throw new HTTPError(400, 'unexpected EOF from HTTP body')
            }

            const consume = Math.min(remain, buf.length)
            const data = Buffer.from(buf.data.subarray(0, consume))
            bufPop(buf, consume)
            remain -= consume
            yield data
        }
        // remove \r\n
        bufPop(buf, 2)
    }
}

// HANDLE REQUEST ENDPOINTS
async function handleReq(req: HTTPReq, body: BodyReader): Promise<HTTPRes> {
    let res: BodyReader

    const countSheep = async function* () {
        try {
            for (let i = 0; i < 10; i++) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                yield Buffer.from(`Sheep ${i}\n`);
            }
        } finally {
            console.log('cleanup!')
        }
    }

    const uri = req.uri.toString('utf-8');
    if (uri.startsWith('/files/')) {
        // serve files from the current working directory
        // FIXME: prevent escaping by `..`
        const range: null | Buffer = fieldGet(req.headers, 'Range')
        let start = range?.toString().slice(range.indexOf('=') + 1).split('-')[0]
        let end = range?.toString().slice(range.indexOf('=') + 1).split('-')[1]
        return await serveStaticFile(uri.slice('/files/'.length), Number(start), Number(end))
    }

    switch (req.uri.toString('latin1')) {
        case '/echo':
            res = body
            break
        case '/sheep':
            res = readerFromGenerator(countSheep())
            break
        default:
            res = readerFromMemory(Buffer.from('No request body found!\n'))
            break
    }

    return {
        code: 200,
        headers: [Buffer.from('Server: my_first_http_server')],
        body: res
    }
}

// SEND THE RESPONSE
function encodeHTTPResp(res: HTTPRes): Buffer {
    const statusLine = `HTTP/1.1 ${res.code} ${getStatusMessage(res.code)}\r\n`;
    const headers = res.headers.map(header => header.toString()).join('\r\n');
    return Buffer.from(`${statusLine}${headers}\r\n\r\n`);
}
function getStatusMessage(code: number): string {
    const statusMessages: { [key: number]: string } = {
        200: 'OK',
        206: 'Partial Content',
        400: 'Bad Request',
        413: 'Payload Too Large',
        501: 'Not Implemented',
    };
    return statusMessages[code] || 'Unknown Status';
}
async function writeHTTPResp(conn: TCPConn, res: HTTPRes): Promise<void> {
    if (res.body.length < 0)
        res.headers.push(Buffer.from("Transfer-Encoding: chunked"))
    else
        res.headers.push(Buffer.from(`Content-Length: ${res.body.length}`))

    // write the header
    await soWrite(conn, encodeHTTPResp(res))

    // write the body
    const crlf = Buffer.from('\r\n')
    for (let last = false; !last;) {
        // each 'data' represents a new chunk
        let data = await res.body.read()

        // end of chunk is represented by 0 last becomes true and loop breaks
        last = data.length === 0

        // length will always be -1 for chunked encoding
        if (res.body.length < 0) {
            // {length}\r\n{data}\r\n
            data = Buffer.concat([
                Buffer.from(data.length.toString(16)), crlf,
                data, crlf
            ])
        }

        if (data.length) await soWrite(conn, data)
    }
}





// SEPARATE METHODS FOR WRITING HEADER AND BODY
async function writeHTTPHeader(conn: TCPConn, res: HTTPRes): Promise<void> {
    if (res.body.length < 0)
        res.headers.push(Buffer.from("Transfer-Encoding: chunked"))
    else
        res.headers.push(Buffer.from(`Content-Length: ${res.body.length}`))

    await soWrite(conn, encodeHTTPResp(res))
}
async function writeHTTPBody(conn: TCPConn, body: BodyReader): Promise<void> {
    const crlf = Buffer.from('\r\n')
    for (let last = false; !last;) {
        // each 'data' represents a new chunk
        let data = await body.read()

        // end of chunk is represented by 0 last becomes true and loop breaks
        last = data.length === 0

        // length will always be -1 for chunked encoding
        if (body.length < 0) {
            // {length}\r\n{data}\r\n
            data = Buffer.concat([
                Buffer.from(data.length.toString(16)), crlf,
                data, crlf
            ])
        }

        if (data.length) await soWrite(conn, data)
    }
}








async function serveClient(conn: TCPConn): Promise<void> {
    const buf: DynBuf = { data: Buffer.alloc(0), length: 0 }
    while (true) {
        // parse request header and remove it from buf
        const msg: null | HTTPReq = cutMessage(buf)
        if (!msg) {
            const data = await soRead(conn)
            bufPush(buf, data)
            if (data.length === 0 && buf.length === 0) return
            if (data.length === 0) throw new HTTPError(400, "Uexpected EOF!")
            continue
        }

        // parse request body in buf
        const reqBody: BodyReader = readerFromReq(conn, buf, msg);

        // with request header and body parsed we now handle/create the response
        const res: HTTPRes = await handleReq(msg, reqBody);
        try {
            // send the response
            await writeHTTPHeader(conn, res);
            if (msg.method !== 'HEAD')
                await writeHTTPBody(conn, res.body);
        } finally {
            await res.body.close?.();
        }


        if (msg.version === '1.0') return
        while ((await reqBody.read()).length > 0) { /* empty */ }
    }
}

async function newConn(socket: net.Socket): Promise<void> {
    const conn: TCPConn = soInit(socket);
    try {
        await serveClient(conn);
    } catch (exc) {
        console.error('exception:', exc);
        if (exc instanceof HTTPError) {
            // intended to send an error response
            const resp: HTTPRes = {
                code: exc.code,
                headers: [],
                body: readerFromMemory(Buffer.from(exc.message + '\n')),
            };
            try {
                await writeHTTPResp(conn, resp);
            } catch (exc) { /* ignore */ }
        }
    } finally {
        socket.destroy();
    }
}

const server = net.createServer(socket => {
    socket.setNoDelay(true)
})
server.on('connection', newConn)
server.on('error', (err: Error) => { throw err })
server.listen({ host: '127.0.0.1', port: 1234 })