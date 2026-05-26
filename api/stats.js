import { Redis } from '@upstash/redis'

const PREFIX = 'daddario-ballend-sort:v1'
const memory = {
  players: new Set(),
  attempts: 0,
  correct: 0,
}

export default async function handler(request, response) {
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')

  if (request.method === 'OPTIONS') {
    response.status(204).end()
    return
  }

  if (request.method === 'GET') {
    response.status(200).json({ stats: await readStats(), source: getSource() })
    return
  }

  if (request.method === 'POST') {
    const body = typeof request.body === 'object' ? request.body : {}
    const playerId = sanitizePlayerId(body.playerId)
    const isCorrect = body.correct === true
    const stats = await recordStats(playerId, isCorrect)

    response.status(200).json({ stats, source: getSource() })
    return
  }

  response.status(405).json({ error: 'Method not allowed' })
}

async function readStats() {
  const redis = getRedis()

  if (!redis) {
    return readMemoryStats()
  }

  try {
    const [players, attempts, correct] = await Promise.all([
      redis.scard(`${PREFIX}:players`),
      redis.get(`${PREFIX}:attempts`),
      redis.get(`${PREFIX}:correct`),
    ])

    return {
      players: toNumber(players),
      attempts: toNumber(attempts),
      correct: toNumber(correct),
    }
  } catch {
    return readMemoryStats()
  }
}

async function recordStats(playerId, isCorrect) {
  const redis = getRedis()

  if (!redis) {
    memory.players.add(playerId)
    memory.attempts += 1
    memory.correct += isCorrect ? 1 : 0
    return readMemoryStats()
  }

  try {
    await Promise.all([
      redis.sadd(`${PREFIX}:players`, playerId),
      redis.incr(`${PREFIX}:attempts`),
      isCorrect ? redis.incr(`${PREFIX}:correct`) : Promise.resolve(),
    ])

    return readStats()
  } catch {
    memory.players.add(playerId)
    memory.attempts += 1
    memory.correct += isCorrect ? 1 : 0
    return readMemoryStats()
  }
}

function getRedis() {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN

  if (!url || !token) {
    return null
  }

  return new Redis({ url, token })
}

function getSource() {
  return getRedis() ? 'redis' : 'memory'
}

function readMemoryStats() {
  return {
    players: memory.players.size,
    attempts: memory.attempts,
    correct: memory.correct,
  }
}

function sanitizePlayerId(value) {
  if (typeof value !== 'string') {
    return `anonymous-${Date.now().toString(36)}`
  }

  return value.replace(/[^a-zA-Z0-9._:-]/g, '').slice(0, 96) || `anonymous-${Date.now().toString(36)}`
}

function toNumber(value) {
  const numberValue = Number(value ?? 0)
  return Number.isFinite(numberValue) ? numberValue : 0
}
