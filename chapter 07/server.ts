import * as net from "net"
import { TCPConn, DynBuf, BodyReader, HTTPReq, HTTPRes } from "./custom_types/index"
import { bufPush, bufPop, fieldGet } from "./methods/buffer"
import { HTTPError, parseHTTPReq } from "./methods/http"

function soInit(socket: net.Socket): TCPConn {
    const conn: TCPConn = {
        socket: socket, err: null, ended: false, reader: null
    }

    socket.on('data', (data: Buffer) => {
        console.assert(conn.reader)
        // pause 'data' event until current read is fulfilled
        conn.socket.pause()
        // fulfill current read
        conn.reader!.resolve(data)
        conn.reader = null
    })

    socket.on('error', (err: Error) => {
        conn.err = err
        if (conn.reader) {
            // promise won't be fulfilled in case of and error
            conn.reader.reject(err)
            conn.reader = null
        }
    })

    socket.on('end', () => {
        conn.ended = true
        // while closing the socket we fulfill the promise
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
        // resume 'data' event after promise is fulfilled
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
            else resolve()
        })
    })
}

// parse and remove header from the beginning of the buffer
const kMaxHeaderLen = 1024 * 8
function cutMessage(buf: DynBuf): null | HTTPReq {
    // end of the header is marked by '\r\n\r\n'
    const idx = buf.data.subarray(0, buf.length).indexOf('\r\n\r\n')
    if (idx < 0) {
        if (buf.length >= kMaxHeaderLen)
            throw new HTTPError(413, 'Header is too large!')
        return null
    }
    console.log("\nBUFFER WITH BOTH HEADER AND BODY\n", buf.data.toString())
    console.log("\nINDEX OF HEADER: ", idx)
    // parse and remove the header
    const msg = parseHTTPReq(buf.data.subarray(0, idx + 4))
    bufPop(buf, idx + 4)
    console.log("\nAFTER REMOVING HEADER: ", buf.data.toString())
    return msg
}

// buf has request body which is parsed here
function readerFromReq(conn: TCPConn, buf: DynBuf, req: HTTPReq): BodyReader {
    console.log("\nPARSING REQUEST BODY")
    console.log("HEADER")
    console.log(req)
    let bodyLen = -1
    const contentLen: null | Buffer = fieldGet(req.headers, 'Content-Length')

    if (contentLen) {
        // parse content length using latin1 encoding
        bodyLen = parseInt(contentLen.toString('latin1'))
        if (isNaN(bodyLen))
            throw new HTTPError(400, 'bad content length')
    }
    // check that it's not a GET or HEAD request 
    const bodyAllowed = !(req.method === 'GET' || req.method === 'HEAD')
    // check if body is chunked
    const chunked = fieldGet(req.headers, 'Transfer-Encoding')?.equals(Buffer.from('chunked')) || false

    // throw error for GET or HEAD request with body
    if (!bodyAllowed && (bodyLen > 0 || chunked))
        throw new HTTPError(400, 'HTTP body not allowed for this method')
    // declare no body for GET or HEAD request
    if (!bodyAllowed) bodyLen = 0

    // if request is allowed then read the body for the specified bodyLen
    if (bodyLen >= 0)
        return readerFromConnLength(conn, buf, bodyLen)
    else if (chunked)
        throw new HTTPError(501, 'TODO')
    else
        throw new HTTPError(501, 'TODO')
}

// given content-length read the body for the specified length(remian)
function readerFromConnLength(conn: TCPConn, buf: DynBuf, remain: number): BodyReader {
    console.log("\n\nreading body from connection")
    console.log("request body: ", buf.data.toString())
    console.log("remaining length: ", remain)
    return {
        length: remain,
        read: async (): Promise<Buffer> => {
            if (remain === 0)
                return Buffer.from('')
            if (buf.length === 0) {
                // try to get some data if none is available
                const data = await soRead(conn)
                bufPush(buf, data)
                if (data.length === 0)
                    throw new HTTPError(400, 'unexpected EOF from HTTP body')
            }
            // remain < buf.length means body has a lot of data but we only want to read some
            // remain > buf.length means read all the data from the req body
            const consume = Math.min(remain, buf.length)
            remain -= consume
            // capture the req body
            const data = Buffer.from(buf.data.subarray(0, consume))
            // clear req body from the buffer
            bufPop(buf, consume)
            return data
        }
    }
}


// HANDLE REQUEST BELOW
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
async function handleReq(req: HTTPReq, body: BodyReader): Promise<HTTPRes> {
    let res: BodyReader
    switch (req.uri.toString('latin1')) {
        case '/echo':
            res = body
            break
        default:
            res = readerFromMemory(Buffer.from('No request body found therefore sending: Hello World!\n'))
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
        400: 'Bad Request',
        413: 'Payload Too Large',
        501: 'Not Implemented',
    };
    return statusMessages[code] || 'Unknown Status';
}
async function writeHTTPResp(conn: TCPConn, res: HTTPRes): Promise<void> {
    if (res.body.length === 0)
        throw new Error('TODO: chunked encoding')

    console.assert(!fieldGet(res.headers, 'Content-Length'))
    // set content-length field
    res.headers.push(Buffer.from(`Content-Length: ${res.body.length}`))

    // write the header
    const encodedHeader = encodeHTTPResp(res)
    console.log("ENCODED HEADER")
    console.log(encodedHeader.toString())
    await soWrite(conn, encodeHTTPResp(res))

    // write the body
    while (true) {
        const data = await res.body.read()
        if (data.length === 0) break
        console.log("DATA TO ECHO BACK TO CLIENT")
        console.log(data.toString());
        await soWrite(conn, data)
    }
}








async function serveClient(conn: TCPConn): Promise<void> {
    const buf: DynBuf = { data: Buffer.alloc(0), length: 0 }
    console.log("serving client...")
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
        // console.log(msg)
        const reqBody: BodyReader = readerFromReq(conn, buf, msg);
        console.log("REQUEST BODY: ", reqBody)

        // with request header and body parsed we now handle/create the response
        const res: HTTPRes = await handleReq(msg, reqBody);
        console.log("RESPONSE: ", res)

        // send the response
        await writeHTTPResp(conn, res);

        if (msg.version === '1.0') return
        while ((await reqBody.read()).length > 0) { /* empty */ }
    }
}

async function newConn(socket: net.Socket): Promise<void> {
    const conn: TCPConn = soInit(socket);
    try {
        console.log("new connection opened, awaiting request...")
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