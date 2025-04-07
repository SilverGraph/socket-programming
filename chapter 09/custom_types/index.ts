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
    // 'Content-Length', -1 if unknown
    length: number;
    // returns an empty buffer after EOF
    read: () => Promise<Buffer>;
    // optional cleanups
    close?: () => Promise<void>;
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

interface FileReadResult {
    bytesRead: number;
    buffer: Buffer;
}

interface FilerReadOptions {
    buffer?: Buffer;
    offset?: number | null;
    length?: number | null;
    position?: number | null;
}

interface Stats {
    isFile(): boolean;
    isDirectory(): boolean;
    size: number;
}

interface FileHandle {
    read(options?: FilerReadOptions): Promise<FileReadResult>;
    close(): Promise<void>;
    stat(): Promise<Stats>;
}

export {
    TCPConn,
    DynBuf,
    BodyReader,
    HTTPReq,
    HTTPRes,
    BufferGenerator,
    FileHandle,
    FilerReadOptions,
    FileReadResult
}