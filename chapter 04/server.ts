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

function soInit(socket: net.Socket): TCPconn {
    const conn: TCPconn = {
        socket: socket, err: null, ended: false, reader: null
    }

    socket.on('data', (data: Buffer) => {
        // if (!conn.reader) return
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
        resolve()
    })
}

async function serveClient(socket: net.Socket): Promise<void> {
    const conn: TCPconn = soInit(socket)
    while (true) {
        const data = await soRead(conn)
        if (data.length === 0) {
            console.log('end connection')
            break
        }
        console.log('data: ', data)
        await soWrite(conn, data)
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