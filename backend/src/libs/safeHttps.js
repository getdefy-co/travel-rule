import dns from 'node:dns';
import https from 'node:https';
import net from 'node:net';

const ipv4Number = address => {
  return address.split('.').reduce((value, octet) => {
    return value * 256n + BigInt(Number(octet));
  }, 0n);
};

const ipv4InRange = (address, base, prefix) => {
  const divisor = BigInt(2 ** (32 - prefix));
  return ipv4Number(address) / divisor === ipv4Number(base) / divisor;
};

const ipv6Number = address => {
  let normalized = address.toLowerCase();
  const dottedTail = normalized.match(/(\d+\.\d+\.\d+\.\d+)$/);

  if (dottedTail) {
    const octets = dottedTail[1].split('.').map(Number);
    const hexadecimalTail = `${(octets[0] * 256 + octets[1]).toString(16)}:${(octets[2] * 256 + octets[3]).toString(16)}`;
    normalized = normalized.slice(0, -dottedTail[1].length) + hexadecimalTail;
  }

  const [left = '', right = ''] = normalized.split('::');
  const leftGroups = left ? left.split(':') : [];
  const rightGroups = right ? right.split(':') : [];
  const missingGroups = 8 - leftGroups.length - rightGroups.length;
  const groups = normalized.includes('::') ? [...leftGroups, ...Array(missingGroups).fill('0'), ...rightGroups] : leftGroups;

  return groups.reduce((value, group) => {
    return value * 65536n + BigInt(`0x${group || '0'}`);
  }, 0n);
};

const powerOfTwo = exponent => {
  return BigInt(`0b1${'0'.repeat(exponent)}`);
};

const ipv6InRange = (value, base, prefix) => {
  const divisor = powerOfTwo(128 - prefix);
  return value / divisor === ipv6Number(base) / divisor;
};

const mappedIpv4 = value => {
  const prefix = value / powerOfTwo(32);

  if (prefix !== 0xffffn && prefix !== 0n) {
    return null;
  }

  let remainder = value % powerOfTwo(32);
  const octets = [16777216n, 65536n, 256n, 1n].map(divisor => {
    const octet = remainder / divisor;
    remainder %= divisor;
    return Number(octet);
  });
  return octets.join('.');
};

const assertPublicIpv4 = address => {
  const denied = [
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
  ];

  if (
    denied.some(([base, prefix]) => {
      return ipv4InRange(address, base, prefix);
    })
  ) {
    throw new Error('HTTPS target must resolve to a public address.');
  }
};

const assertPublicAddress = address => {
  const version = net.isIP(address);

  if (version === 4) {
    assertPublicIpv4(address);
    return;
  }

  if (version !== 6) {
    throw new Error('HTTPS target must resolve to a public address.');
  }

  const value = ipv6Number(address);
  const mapped = mappedIpv4(value);

  if (mapped) {
    assertPublicIpv4(mapped);
    return;
  }

  if (value === 0n || value === 1n || ipv6InRange(value, 'fc00::', 7) || ipv6InRange(value, 'fe80::', 10) || ipv6InRange(value, 'ff00::', 8) || ipv6InRange(value, '2001:db8::', 32)) {
    throw new Error('HTTPS target must resolve to a public address.');
  }
};

const validateHttpsTarget = value => {
  let target;

  try {
    target = new URL(value);
  } catch (error) {
    throw new Error('Invalid HTTPS target.');
  }

  if (target.protocol !== 'https:' || target.username || target.password || target.hash) {
    throw new Error('Invalid HTTPS target.');
  }

  return target;
};

const resolvePublicTarget = async (value, lookup = dns.promises.lookup) => {
  const target = validateHttpsTarget(value);
  const hostname = target.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(hostname) ? [{ address: hostname, family: net.isIP(hostname) }] : await lookup(hostname, { all: true, verbatim: true });

  if (!addresses.length) {
    throw new Error('HTTPS target did not resolve.');
  }

  addresses.forEach(({ address }) => {
    assertPublicAddress(address);
  });
  return { target, address: addresses[0].address, family: addresses[0].family };
};

const postJson = async ({ url, body, headers = {}, timeoutMs, tls, lookup }) => {
  const resolved = await resolvePublicTarget(url, lookup);
  const payload = Buffer.from(JSON.stringify(body), 'utf8');

  return new Promise((resolve, reject) => {
    const request = https.request(
      resolved.target,
      {
        agent: false,
        ca: tls.ca,
        cert: tls.cert,
        headers: { ...headers, 'content-length': payload.length, 'content-type': 'application/json' },
        key: tls.key,
        lookup: (_hostname, _options, callback) => {
          return callback(null, resolved.address, resolved.family);
        },
        method: 'POST',
        minVersion: 'TLSv1.3',
        servername: resolved.target.hostname,
        timeout: timeoutMs,
      },
      response => {
        const chunks = [];
        let size = 0;

        response.on('data', chunk => {
          size += chunk.length;

          if (size > 1024 * 1024) {
            request.destroy(new Error('TRP peer response exceeded 1 MB.'));
            return;
          }

          chunks.push(chunk);
        });
        response.on('end', () => {
          if (response.statusCode >= 300 && response.statusCode < 400) {
            reject(new Error('TRP redirects are not allowed.'));
            return;
          }

          const text = Buffer.concat(chunks).toString('utf8');
          let responseBody = null;

          if (text) {
            try {
              responseBody = JSON.parse(text);
            } catch (error) {
              reject(new Error('TRP peer returned invalid JSON.'));
              return;
            }
          }

          resolve({ body: responseBody, headers: response.headers, statusCode: response.statusCode });
        });
      },
    );

    request.on('timeout', () => {
      request.destroy(new Error('TRP peer request timed out.'));
    });
    request.on('error', reject);
    request.end(payload);
  });
};

export { assertPublicAddress, postJson, resolvePublicTarget, validateHttpsTarget };
