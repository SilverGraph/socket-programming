import * as net from "net"

function newConn(socket: net.Socket): void {
    console.log('new connection', socket.remoteAddress, socket.remotePort);

    // CLOSE SOCKET
    socket.on('end', () => {
        console.log('EOF');
    })

    // RECEIVE(write)
    socket.on('data', (data: Buffer) => {
        console.log('data: ', data);
        socket.write(data); // echo back data to the peer

        if (data.includes('q')) {
            console.log('Closing connection...');
            // send FIN and close connection
            socket.end()
        }
    })
}

let server = net.createServer({ allowHalfOpen: true })
// LISTENING SOCKET
server.on('connection', newConn)
server.on('error', (err: Error) => { throw err })
server.listen({ host: '127.0.0.1', port: 1234 })