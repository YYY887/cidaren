/**
 * HTTPS MITM 代理抓包模块
 * 拦截 app.vocabgo.com 的请求，提取鉴权 headers (usertoken, abc, authorization-v)
 * 其他域名直接透传不做中间人攻击
 */

import { createServer, IncomingMessage, ServerResponse, Server } from 'http'
import { createServer as createTlsServer, TLSSocket } from 'tls'
import { connect as netConnect, Socket } from 'net'
import * as https from 'https'
import { execFileSync } from 'child_process'
import { pki, md as forgeMd } from 'node-forge'
import * as fs from 'fs'
import * as path from 'path'
import { EventEmitter } from 'events'

/** 抓取到的 token 信息 */
export interface CapturedTokens {
  usertoken: string
  abc: string
  authV: string
}

/**
 * HTTPS MITM 代理
 * 仅对 app.vocabgo.com 进行中间人拦截，提取鉴权 headers
 */
export class ProxyCapture extends EventEmitter {
  private server: Server | null = null
  private port = 8899
  private running = false
  private caCertPath = ''
  private caKeyPath = ''
  private caCert: pki.Certificate | null = null
  private caKey: pki.rsa.PrivateKey | null = null
  private userDataDir: string

  /** 缓存已生成的域名证书 */
  private certCache = new Map<string, { cert: string; key: string }>()

  constructor(userDataDir: string) {
    super()
    this.userDataDir = userDataDir
    const caDir = path.join(userDataDir, 'proxy-ca')
    this.caCertPath = path.join(caDir, 'ca.crt')
    this.caKeyPath = path.join(caDir, 'ca.key')
  }

  /** 启动代理服务器 */
  async start(port?: number): Promise<void> {
    if (this.running) return

    if (port) this.port = port

    // 确保 CA 证书存在
    this.ensureCaCert()

    // 自动安装 CA 证书到系统信任存储
    this.installCaCert()

    // 创建 HTTP 代理服务器处理 CONNECT 请求
    this.server = createServer(this.handleHttpRequest.bind(this))
    this.server.on('connect', this.handleConnect.bind(this))
    this.server.on('error', (err) => this.emit('error', err))

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(this.port, '127.0.0.1', () => {
        this.running = true
        this.emit('log', `代理服务器已启动: 127.0.0.1:${this.port}`)
        resolve()
      })
      this.server!.on('error', reject)
    })

    // 自动设置系统代理
    this.saveAndEnableSystemProxy()
  }

  /** 停止代理服务器 */
  async stop(): Promise<void> {
    if (!this.running || !this.server) return

    // 恢复系统代理
    this.restoreSystemProxy()

    return new Promise<void>((resolve) => {
      this.server!.close(() => {
        this.running = false
        this.server = null
        this.emit('log', '代理服务器已停止')
        resolve()
      })
      // 强制关闭所有连接
      this.server!.closeAllConnections?.()
    })
  }

  /** 获取监听端口 */
  getPort(): number {
    return this.port
  }

  /** 获取 CA 证书路径 */
  getCaCertPath(): string {
    return this.caCertPath
  }

  /** 是否正在运行 */
  isRunning(): boolean {
    return this.running
  }

  // ── 私有方法 ──

  /** 确保 CA 证书已生成 */
  private ensureCaCert(): void {
    const caDir = path.dirname(this.caCertPath)
    if (!fs.existsSync(caDir)) {
      fs.mkdirSync(caDir, { recursive: true })
    }

    if (fs.existsSync(this.caCertPath) && fs.existsSync(this.caKeyPath)) {
      // 加载已有 CA
      const certPem = fs.readFileSync(this.caCertPath, 'utf-8')
      const keyPem = fs.readFileSync(this.caKeyPath, 'utf-8')
      this.caCert = pki.certificateFromPem(certPem)
      this.caKey = pki.privateKeyFromPem(keyPem)
      this.emit('log', 'CA 证书已加载')
    } else {
      // 生成新 CA
      this.generateCaCert()
      this.emit('log', 'CA 证书已生成')
    }
  }

  /** 自动安装 CA 证书到系统信任存储 */
  private installCaCert(): void {
    if (!fs.existsSync(this.caCertPath)) return

    const platform = process.platform

    try {
      if (platform === 'linux') {
        // 安装到 NSS 数据库（Chromium/微信使用）
        const nssDbPath = path.join(process.env.HOME || '', '.pki', 'nssdb')
        if (!fs.existsSync(nssDbPath)) {
          fs.mkdirSync(nssDbPath, { recursive: true })
        }
        try {
          // 先删除旧的（如果存在）
          execFileSync('certutil', ['-d', `sql:${nssDbPath}`, '-D', '-n', 'Cidaren Proxy CA'], {
            timeout: 5000,
            stdio: 'ignore',
          })
        } catch { /* 不存在时忽略 */ }

        execFileSync('certutil', [
          '-d', `sql:${nssDbPath}`,
          '-A', '-t', 'C,,',
          '-n', 'Cidaren Proxy CA',
          '-i', this.caCertPath,
        ], { timeout: 10000 })
        this.emit('log', 'CA 证书已安装到系统信任存储 (nssdb)')
      } else if (platform === 'win32') {
        try {
          execFileSync('certutil', ['-addstore', '-f', '-user', 'Root', this.caCertPath], {
            timeout: 10000,
            stdio: 'ignore',
          })
          this.emit('log', 'CA 证书已安装到系统信任存储')
        } catch {
          // 尝试 PowerShell
          const psCmd = `Import-Certificate -FilePath "${this.caCertPath}" -CertStoreLocation Cert:\\CurrentUser\\Root`
          execFileSync('powershell', ['-NoProfile', '-NoLogo', '-Command', psCmd], {
            timeout: 10000,
            stdio: 'ignore',
          })
          this.emit('log', 'CA 证书已安装到系统信任存储 (PowerShell)')
        }
      } else if (platform === 'darwin') {
        const home = process.env.HOME || ''
        const keychain = path.join(home, 'Library/Keychains/login.keychain-db')
        execFileSync('security', ['add-trusted-cert', '-r', 'trustRoot', '-k', keychain, this.caCertPath], {
          timeout: 10000,
          stdio: 'ignore',
        })
        this.emit('log', 'CA 证书已安装到系统信任存储')
      }
    } catch (e) {
      this.emit('log', `CA 证书自动安装失败: ${e instanceof Error ? e.message : String(e)}`)
      this.emit('log', `请手动安装: ${this.caCertPath}`)
    }
  }

  /** 生成自签名 CA 证书 */
  private generateCaCert(): void {
    const keys = pki.rsa.generateKeyPair(2048)
    const cert = pki.createCertificate()

    cert.publicKey = keys.publicKey
    cert.serialNumber = '01'
    cert.validity.notBefore = new Date()
    cert.validity.notAfter = new Date()
    cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 10)

    const attrs = [
      { name: 'commonName', value: 'Cidaren Proxy CA' },
      { name: 'organizationName', value: 'Cidaren' },
      { name: 'countryName', value: 'CN' },
    ]

    cert.setSubject(attrs)
    cert.setIssuer(attrs)
    cert.setExtensions([
      { name: 'basicConstraints', cA: true },
      {
        name: 'keyUsage',
        keyCertSign: true,
        digitalSignature: true,
        cRLSign: true,
      },
      {
        name: 'subjectKeyIdentifier',
      },
    ])

    cert.sign(keys.privateKey, forgeMd.sha256.create())

    const certPem = pki.certificateToPem(cert)
    const keyPem = pki.privateKeyToPem(keys.privateKey)

    fs.writeFileSync(this.caCertPath, certPem, 'utf-8')
    fs.writeFileSync(this.caKeyPath, keyPem, 'utf-8')

    this.caCert = cert
    this.caKey = keys.privateKey
  }

  /** 为指定域名生成证书（由 CA 签发） */
  private generateHostCert(hostname: string): { cert: string; key: string } {
    const cached = this.certCache.get(hostname)
    if (cached) return cached

    const keys = pki.rsa.generateKeyPair(2048)
    const cert = pki.createCertificate()

    cert.publicKey = keys.publicKey
    cert.serialNumber = Date.now().toString(16)
    cert.validity.notBefore = new Date()
    cert.validity.notAfter = new Date()
    cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 1)

    cert.setSubject([{ name: 'commonName', value: hostname }])
    cert.setIssuer(this.caCert!.subject.attributes)
    cert.setExtensions([
      { name: 'basicConstraints', cA: false },
      {
        name: 'subjectAltName',
        altNames: [{ type: 2, value: hostname }],
      },
    ])

    cert.sign(this.caKey!, forgeMd.sha256.create())

    const result = {
      cert: pki.certificateToPem(cert),
      key: pki.privateKeyToPem(keys.privateKey),
    }

    this.certCache.set(hostname, result)
    return result
  }

  /** 处理普通 HTTP 请求（非 CONNECT） */
  private handleHttpRequest(_req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('Cidaren Proxy is running. Configure your system proxy to use this server.\n')
  }

  /** 处理 CONNECT 隧道请求 */
  private handleConnect(req: IncomingMessage, clientSocket: Socket, head: Buffer): void {
    const [hostname, portStr] = (req.url || '').split(':')
    const port = parseInt(portStr || '443', 10)

    this.emit('log', `CONNECT ${hostname}:${port}`)

    if (hostname === 'app.vocabgo.com') {
      // MITM: 拦截 vocabgo 请求
      this.mitmConnect(clientSocket, head, hostname, port)
    } else {
      // 透传: 直接隧道转发
      this.tunnelConnect(clientSocket, head, hostname, port)
    }
  }

  /** 透传隧道（不拦截） */
  private tunnelConnect(clientSocket: Socket, head: Buffer, hostname: string, port: number): void {
    const serverSocket = netConnect(port, hostname, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length > 0) {
        serverSocket.write(new Uint8Array(head))
      }
      serverSocket.pipe(clientSocket)
      clientSocket.pipe(serverSocket)
    })

    serverSocket.on('error', (err) => {
      this.emit('log', `隧道连接失败 ${hostname}:${port}: ${err.message}`)
      clientSocket.end()
    })

    clientSocket.on('error', () => {
      serverSocket.end()
    })
  }

  /** MITM 拦截 */
  private mitmConnect(clientSocket: Socket, head: Buffer, hostname: string, port: number): void {
    try {
      // 生成目标域名的证书
      const hostCert = this.generateHostCert(hostname)

      // 创建本地 TLS 服务器来接收客户端连接
      const localServer = createTlsServer(
        {
          key: hostCert.key,
          cert: hostCert.cert + pki.certificateToPem(this.caCert!),
          requestCert: false,
          rejectUnauthorized: false,
        },
        (tlsSocket: TLSSocket) => {
          // TLS 握手成功，处理 HTTP 请求
          this.handleMitmConnection(tlsSocket, hostname, port)
        }
      )

      localServer.on('tlsClientError', (err: Error) => {
        this.emit('log', `TLS 客户端错误 ${hostname}: ${err.message}`)
      })

      localServer.on('error', (err: Error) => {
        this.emit('log', `本地 TLS 服务器错误: ${err.message}`)
        clientSocket.end()
      })

      // 监听随机端口
      localServer.listen(0, '127.0.0.1', () => {
        const addr = localServer.address() as { port: number }
        const localPort = addr.port

        // 告知客户端隧道已建立
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')

        // 将客户端连接转发到本地 TLS 服务器
        const localConn = netConnect(localPort, '127.0.0.1', () => {
          if (head && head.length > 0) {
            localConn.write(new Uint8Array(head))
          }
          clientSocket.pipe(localConn)
          localConn.pipe(clientSocket)
        })

        localConn.on('error', () => { clientSocket.end() })
        clientSocket.on('error', () => { localConn.end() })
        clientSocket.on('close', () => {
          localConn.end()
          localServer.close()
        })
      })
    } catch (err) {
      this.emit('log', `MITM 错误 ${hostname}: ${err instanceof Error ? err.message : String(err)}`)
      clientSocket.end()
    }
  }

  /** 处理 MITM 解密后的连接 */
  private handleMitmConnection(tlsSocket: TLSSocket, hostname: string, port: number): void {
    let requestBuffer = Buffer.alloc(0)

    tlsSocket.on('data', (chunk: Uint8Array) => {
      requestBuffer = Buffer.concat([requestBuffer, Buffer.from(chunk)] as Uint8Array[])

      const headerEnd = requestBuffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) return

      // 解析完整请求头
      const headerStr = requestBuffer.slice(0, headerEnd).toString('utf-8')
      const bodyStart = requestBuffer.slice(headerEnd + 4)

      const lines = headerStr.split('\r\n')
      const requestLine = lines[0] || ''
      this.emit('log', `[请求] ${requestLine}`)

      // 提取 token
      this.extractTokens(headerStr)

      // 解析 headers
      const [method, urlPath] = requestLine.split(' ')
      const headers: Record<string, string> = {}
      for (const line of lines.slice(1)) {
        const colonIdx = line.indexOf(':')
        if (colonIdx === -1) continue
        const name = line.slice(0, colonIdx).trim()
        const value = line.slice(colonIdx + 1).trim()
        if (name.toLowerCase() === 'proxy-connection') continue
        headers[name] = value
      }

      // 清空 buffer（已消费）
      requestBuffer = Buffer.alloc(0)

      // 转发请求到真实服务器
      const proxyReq = https.request(
        {
          hostname,
          port,
          method,
          path: urlPath,
          headers,
          rejectUnauthorized: true,
        },
        (proxyRes) => {
          let responseHeader = `HTTP/${proxyRes.httpVersion} ${proxyRes.statusCode} ${proxyRes.statusMessage}\r\n`
          const rawHeaders = proxyRes.rawHeaders
          for (let i = 0; i < rawHeaders.length; i += 2) {
            responseHeader += `${rawHeaders[i]}: ${rawHeaders[i + 1]}\r\n`
          }
          responseHeader += '\r\n'

          try { tlsSocket.write(responseHeader) } catch { return }

          proxyRes.on('data', (data: Uint8Array) => {
            try { tlsSocket.write(data) } catch { /* ignore */ }
          })

          proxyRes.on('end', () => {
            // 不关闭 tlsSocket，保持 keep-alive
          })
        }
      )

      proxyReq.on('error', (err) => {
        this.emit('log', `[转发错误] ${hostname}: ${err.message}`)
        try { tlsSocket.end() } catch { /* ignore */ }
      })

      if (bodyStart.length > 0) {
        proxyReq.write(new Uint8Array(bodyStart))
      }
      proxyReq.end()
    })

    tlsSocket.on('error', () => { /* ignore */ })
    tlsSocket.on('end', () => { /* connection closed by client */ })
  }

  /** 从 HTTP 请求头中提取 token */
  private extractTokens(headerStr: string): void {
    const lines = headerStr.split('\r\n')

    let usertoken = ''
    let abc = ''
    let authV = ''

    for (const line of lines.slice(1)) {
      const colonIdx = line.indexOf(':')
      if (colonIdx === -1) continue
      const name = line.slice(0, colonIdx).trim().toLowerCase()
      const value = line.slice(colonIdx + 1).trim()

      if (name === 'usertoken') usertoken = value
      else if (name === 'abc') abc = value
      else if (name === 'authorization-v') authV = value
    }

    if (usertoken && abc && authV) {
      this.emit('log', '成功捕获 Token!')
      this.emit('captured', { usertoken, abc, authV } as CapturedTokens)
    } else if (usertoken || abc || authV) {
      this.emit('log', `部分 Token 检测到: usertoken=${!!usertoken}, abc=${!!abc}, authV=${!!authV}`)
    }
  }

  // ── 系统代理管理 ──

  /** 原始 GNOME 代理设置 */
  private originalProxySettings: {
    mode: string | null
    host: string | null
    port: string | null
    httpsHost: string | null
    httpsPort: string | null
  } | null = null

  /** gsettings get 封装 */
  private gsettingsGet(schema: string, key: string): string | null {
    try {
      const result = execFileSync('gsettings', ['get', schema, key], {
        encoding: 'utf-8',
        timeout: 5000,
      })
      return result.trim().replace(/^'|'$/g, '')
    } catch {
      return null
    }
  }

  /** gsettings set 封装 */
  private gsettingsSet(schema: string, key: string, value: string): void {
    try {
      execFileSync('gsettings', ['set', schema, key, value], { timeout: 5000 })
    } catch {
      // 静默失败
    }
  }

  /** 保存当前代理设置并启用系统代理 */
  private saveAndEnableSystemProxy(): void {
    const platform = process.platform

    if (platform === 'linux') {
      // 保存当前 GNOME 代理设置
      this.originalProxySettings = {
        mode: this.gsettingsGet('org.gnome.system.proxy', 'mode'),
        host: this.gsettingsGet('org.gnome.system.proxy.http', 'host'),
        port: this.gsettingsGet('org.gnome.system.proxy.http', 'port'),
        httpsHost: this.gsettingsGet('org.gnome.system.proxy.https', 'host'),
        httpsPort: this.gsettingsGet('org.gnome.system.proxy.https', 'port'),
      }

      // 设置系统代理
      this.gsettingsSet('org.gnome.system.proxy.http', 'host', '127.0.0.1')
      this.gsettingsSet('org.gnome.system.proxy.http', 'port', String(this.port))
      this.gsettingsSet('org.gnome.system.proxy.https', 'host', '127.0.0.1')
      this.gsettingsSet('org.gnome.system.proxy.https', 'port', String(this.port))
      this.gsettingsSet('org.gnome.system.proxy', 'mode', "'manual'")
      this.emit('log', '已自动设置系统代理')
    } else if (platform === 'win32') {
      try {
        const proxyServer = `127.0.0.1:${this.port}`
        execFileSync('reg', [
          'add',
          'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
          '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '1', '/f',
        ], { encoding: 'utf-8' })
        execFileSync('reg', [
          'add',
          'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
          '/v', 'ProxyServer', '/t', 'REG_SZ', '/d', proxyServer, '/f',
        ], { encoding: 'utf-8' })
        this.emit('log', `已自动设置系统代理: ${proxyServer}`)
      } catch (e) {
        this.emit('log', `设置系统代理失败: ${e instanceof Error ? e.message : String(e)}`)
      }
    } else if (platform === 'darwin') {
      try {
        const services = execFileSync('networksetup', ['-listallnetworkservices'], {
          encoding: 'utf-8',
        }).split('\n').slice(1).filter((s) => s.trim() && !s.startsWith('*'))

        for (const service of services) {
          try {
            execFileSync('networksetup', ['-setwebproxy', service, '127.0.0.1', String(this.port)], { stdio: 'ignore' })
            execFileSync('networksetup', ['-setsecurewebproxy', service, '127.0.0.1', String(this.port)], { stdio: 'ignore' })
          } catch { /* ignore */ }
        }
        this.emit('log', '已自动设置系统代理')
      } catch (e) {
        this.emit('log', `设置系统代理失败: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  /** 恢复原始系统代理设置 */
  private restoreSystemProxy(): void {
    const platform = process.platform

    if (platform === 'linux') {
      if (this.originalProxySettings) {
        const s = this.originalProxySettings
        if (!s.mode || s.mode === 'none') {
          this.gsettingsSet('org.gnome.system.proxy', 'mode', "'none'")
        } else {
          if (s.host) this.gsettingsSet('org.gnome.system.proxy.http', 'host', s.host)
          if (s.port) this.gsettingsSet('org.gnome.system.proxy.http', 'port', s.port)
          if (s.httpsHost) this.gsettingsSet('org.gnome.system.proxy.https', 'host', s.httpsHost)
          if (s.httpsPort) this.gsettingsSet('org.gnome.system.proxy.https', 'port', s.httpsPort)
          this.gsettingsSet('org.gnome.system.proxy', 'mode', `'${s.mode}'`)
        }
      } else {
        this.gsettingsSet('org.gnome.system.proxy', 'mode', "'none'")
      }
      this.emit('log', '已恢复系统代理设置')
    } else if (platform === 'win32') {
      try {
        execFileSync('reg', [
          'add',
          'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
          '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '0', '/f',
        ], { encoding: 'utf-8' })
        this.emit('log', '已恢复系统代理设置')
      } catch { /* ignore */ }
    } else if (platform === 'darwin') {
      try {
        const services = execFileSync('networksetup', ['-listallnetworkservices'], {
          encoding: 'utf-8',
        }).split('\n').slice(1).filter((s) => s.trim() && !s.startsWith('*'))

        for (const service of services) {
          try {
            execFileSync('networksetup', ['-setwebproxystate', service, 'off'], { stdio: 'ignore' })
            execFileSync('networksetup', ['-setsecurewebproxystate', service, 'off'], { stdio: 'ignore' })
          } catch { /* ignore */ }
        }
        this.emit('log', '已恢复系统代理设置')
      } catch { /* ignore */ }
    }
  }
}
