import * as net from "net"

type TCPConn = {
    socket: net.Socket;
    err: null | Error;
    ended: boolean;
    reader: null | {
        resolve: (value: Buffer) => void,
        reject: (reason: Error) => void
    }
}

type DynBuf = {
    data: Buffer;
    length: number;
    start?: number;
}

/* The payload body can be arbitrarily long, it may not even fit in memory, 
    thus we have to use the read(). And when using chunked encoding, 
    the length of the body is not known.
*/
type BodyReader = {
    length: number,
    read: () => Promise<Buffer>
}

type HTTPReq = {
    method: string,
    uri: Buffer,
    /* HTTP uses plaintext but we don't know if it follows ASCII or UTF-8 
        so for safety we define URI as a buffer for now */
    version: string,
    headers: Buffer[]
}

type HTTPRes = {
    code: number,
    headers: Buffer[],
    body: BodyReader
}

type BufferGenerator = AsyncGenerator<Buffer, void, void>

export { TCPConn, DynBuf, BodyReader, HTTPReq, HTTPRes, BufferGenerator }