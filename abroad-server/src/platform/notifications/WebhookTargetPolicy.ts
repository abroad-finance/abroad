import { injectable } from 'inversify'
import { promises as dns } from 'node:dns'
import { Agent } from 'node:https'
import { BlockList, isIP, LookupFunction } from 'node:net'

const blockedAddresses = new BlockList()

const blockedIpv4Subnets: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]

const blockedIpv6Subnets: ReadonlyArray<readonly [string, number]> = [
  ['::', 128],
  ['::1', 128],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
]

for (const [network, prefix] of blockedIpv4Subnets) {
  blockedAddresses.addSubnet(network, prefix, 'ipv4')
}
for (const [network, prefix] of blockedIpv6Subnets) {
  blockedAddresses.addSubnet(network, prefix, 'ipv6')
}

export type ValidatedWebhookTarget = {
  httpsAgent: Agent
  url: string
}

export class WebhookTargetValidationError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'WebhookTargetValidationError'
  }
}

@injectable()
export class WebhookTargetPolicy {
  public async validate(rawUrl: string): Promise<ValidatedWebhookTarget> {
    const parsed = this.parse(rawUrl)
    const addresses = await this.resolvePublicAddresses(
      this.normalizeHostname(parsed.hostname),
    )
    return {
      httpsAgent: new Agent({
        keepAlive: false,
        lookup: this.buildPinnedLookup(addresses),
      }),
      url: parsed.toString(),
    }
  }

  private buildPinnedLookup(
    addresses: ReadonlyArray<{ address: string, family: 4 | 6 }>,
  ): LookupFunction {
    return (_hostname, options, callback) => {
      const requestedFamily = options.family === 4 || options.family === 6
        ? options.family
        : undefined
      const eligible = requestedFamily
        ? addresses.filter(address => address.family === requestedFamily)
        : addresses
      if (eligible.length === 0) {
        const error = new Error('No validated webhook address matches the requested family') as NodeJS.ErrnoException
        error.code = 'ENOTFOUND'
        callback(error, [])
        return
      }
      if (options.all) {
        callback(null, [...eligible])
        return
      }
      callback(null, eligible[0].address, eligible[0].family)
    }
  }

  private isBlockedAddress(address: string, family: 4 | 6): boolean {
    const normalizedAddress = address.toLowerCase()
    if (
      family === 6
      && (
        normalizedAddress.startsWith('::ffff:')
        || normalizedAddress.startsWith('0:0:0:0:0:ffff:')
      )
    ) {
      // Mapped literals have multiple equivalent textual representations. Reject
      // the whole mapped range rather than risk applying IPv6 policy to an IPv4
      // destination after normalization by URL, DNS, or the socket layer.
      return true
    }
    return blockedAddresses.check(address, family === 4 ? 'ipv4' : 'ipv6')
  }

  private normalizeHostname(hostname: string): string {
    const normalized = hostname.toLowerCase().replace(/\.$/u, '')
    return normalized.startsWith('[') && normalized.endsWith(']')
      ? normalized.slice(1, -1)
      : normalized
  }

  private parse(rawUrl: string): URL {
    let parsed: URL
    try {
      parsed = new URL(rawUrl.trim())
    }
    catch {
      throw new WebhookTargetValidationError('Webhook URL is invalid')
    }
    if (
      parsed.protocol !== 'https:'
      || parsed.username
      || parsed.password
      || parsed.hash
      || !parsed.hostname
    ) {
      throw new WebhookTargetValidationError(
        'Webhook URL must be an HTTPS address without credentials or a fragment',
      )
    }
    const hostname = this.normalizeHostname(parsed.hostname)
    if (
      hostname === 'localhost'
      || hostname.endsWith('.localhost')
      || hostname.endsWith('.local')
      || hostname.endsWith('.internal')
    ) {
      throw new WebhookTargetValidationError('Webhook URL must resolve to a public address')
    }
    parsed.hostname = hostname
    return parsed
  }

  private async resolvePublicAddresses(
    hostname: string,
  ): Promise<Array<{ address: string, family: 4 | 6 }>> {
    let addresses: Array<{ address: string, family: 4 | 6 }>
    const literalFamily = isIP(hostname)
    if (literalFamily === 4 || literalFamily === 6) {
      addresses = [{ address: hostname, family: literalFamily }]
    }
    else {
      try {
        const resolved = await dns.lookup(hostname, { all: true, verbatim: true })
        addresses = resolved.flatMap(address => (
          address.family === 4 || address.family === 6
            ? [{ address: address.address, family: address.family }]
            : []
        ))
      }
      catch {
        throw new WebhookTargetValidationError('Webhook URL could not be resolved')
      }
    }
    if (
      addresses.length === 0
      || addresses.some(address => this.isBlockedAddress(address.address, address.family))
    ) {
      throw new WebhookTargetValidationError('Webhook URL must resolve only to public addresses')
    }
    return addresses
  }
}
