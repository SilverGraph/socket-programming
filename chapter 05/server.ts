import * as net from "net"

type TCPconn = {
    socket: net.Socket;
    err: null | Error;
    ended: boolean;
    reader: null | {
        resolve: (value: Buffer) => void,
        reject: (reason: Error) => void
    }
}

// Dynamic buffer
type DynBuf = {
    data: Buffer;
    length: number;
    start?: number;
}

function soInit(socket: net.Socket): TCPconn {
    const conn: TCPconn = {
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

function soRead(conn: TCPconn): Promise<Buffer> {
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

function soWrite(conn: TCPconn, data: Buffer): Promise<void> {
    // console.assert(data.length > 0)
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

// allocating buffers of a complete msg and expaniding it as needed
function bufPush(buf: DynBuf, data: Buffer): void {
    const newLen = buf.length + data.length
    if (newLen > buf.data.length) {
        let cap = Math.max(buf.data.length, 32)
        // double the capacity until it's enough
        while (cap < newLen) cap *= 2
        const grown = Buffer.alloc(cap)
        buf.data.copy(grown, 0, 0)
        buf.data = grown
    }
    data.copy(buf.data, buf.length, 0)
    buf.length = newLen
}
function bufPop(buf: DynBuf, len: number): void {
    buf.data.copyWithin(0, len, buf.length) // (insert pos, start, end)
    buf.length -= len
}
// this function checks for a complete message
// a complete message is a sequence of bytes ending with '\n'
// if a complete message is found, it returns it and empties the buffer
function cutMessage(buf: DynBuf): null | Buffer {
    // individual messages are separated by new-line
    const idx = buf.data.subarray(0, buf.length).indexOf('\n')
    if (idx < 0) return null
    const msg = Buffer.from(buf.data.subarray(0, idx + 1))
    bufPop(buf, idx + 1)
    return msg
}
function amortizedCutMessage(buf: DynBuf): null | Buffer {
    const idx = buf.data.subarray(0, buf.length).indexOf('\n')
    if (idx < 0) return null

    const msg = Buffer.from(buf.data.subarray(0, idx + 1))
    buf.start = idx + 1
    buf.length -= idx + 1
    if (buf.length <= (buf.data.length / 2))
        bufPop(buf, buf.start)
    return msg
}
async function serveClient(socket: net.Socket): Promise<void> {
    const conn: TCPconn = soInit(socket)
    const buf: DynBuf = { data: Buffer.alloc(0), length: 0 }
    while (true) {
        const msg: null | Buffer = cutMessage(buf)
        if (!msg) {
            const data: Buffer = await soRead(conn)
            bufPush(buf, data)
            if (data.length === 0) return
            continue
        }
        // process message and send response
        if (msg.equals(Buffer.from('quit\n'))) {
            await soWrite(conn, Buffer.from('Bye\n'))
            socket.destroy()
            return
        } else {
            const reply = Buffer.concat([Buffer.from('Echo: '), msg])
            await soWrite(conn, reply)
        }
    }
}

async function newConn(socket: net.Socket): Promise<void> {
    console.log('new connection: ', socket.remoteAddress, socket.remotePort);
    try {
        await serveClient(socket)
    } catch (exc) {
        console.error("exception: ", exc);
    } finally {
        socket.destroy()
    }
}

const server = net.createServer({
    pauseOnConnect: true
})
server.on('connection', newConn)
server.on('error', (err: Error) => { throw err })
server.listen({ host: '127.0.0.1', port: 1234 })