import { Redis } from '@upstash/redis'

const PREFIX = 'hue-order:v1'
const ANSWER = ['gold', 'red', 'black', 'green', 'purple', 'silver']
const memory = {
  players: new Set(),
  attempts: 0,
  correct: 0,
  stringHits: 0,
  colors: createEmptyColorStats(),
  hitDistribution: createEmptyHitDistribution(),
  firstPicks: createEmptyColorCounts(),
  lastPicks: createEmptyColorCounts(),
  pickOrder: createEmptyPickOrder(),
  pairMistakes: {},
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
    const answer = sanitizeAnswer(body.answer)
    const isCorrect = answer.length > 0 ? isPerfect(answer) : body.correct === true
    const stats = await recordStats(playerId, isCorrect, answer)

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
    const [
      players,
      attempts,
      correct,
      stringHits,
      colors,
      hitDistribution,
      firstPicks,
      lastPicks,
      pickOrder,
      pairMistakes,
    ] = await Promise.all([
      redis.scard(`${PREFIX}:players`),
      redis.get(`${PREFIX}:attempts`),
      redis.get(`${PREFIX}:correct`),
      redis.get(`${PREFIX}:stringHits`),
      readRedisColorStats(redis),
      readRedisHitDistribution(redis),
      readRedisColorCounts(redis, 'first'),
      readRedisColorCounts(redis, 'last'),
      readRedisPickOrder(redis),
      readRedisPairMistakes(redis),
    ])

    return {
      players: toNumber(players),
      attempts: toNumber(attempts),
      correct: toNumber(correct),
      stringHits: toNumber(stringHits),
      colors,
      hitDistribution,
      firstPicks,
      lastPicks,
      pickOrder,
      pairMistakes,
    }
  } catch {
    return readMemoryStats()
  }
}

async function recordStats(playerId, isCorrect, answer) {
  const redis = getRedis()
  const score = answer.length > 0 ? getSlotHits(answer) : isCorrect ? ANSWER.length : 0

  if (!redis) {
    memory.players.add(playerId)
    memory.attempts += 1
    memory.correct += isCorrect ? 1 : 0
    recordMemoryColorStats(answer, score)
    return readMemoryStats()
  }

  try {
    const writes = [
      redis.sadd(`${PREFIX}:players`, playerId),
      redis.incr(`${PREFIX}:attempts`),
      isCorrect ? redis.incr(`${PREFIX}:correct`) : Promise.resolve(),
    ]

    if (answer.length > 0) {
      writes.push(redis.incrby(`${PREFIX}:stringHits`, score))
      writes.push(redis.incr(`${PREFIX}:hit:${score}`))
      writes.push(redis.incr(`${PREFIX}:first:${answer[0]}`))
      writes.push(redis.incr(`${PREFIX}:last:${answer[ANSWER.length - 1]}`))

      ANSWER.forEach((id, index) => {
        writes.push(redis.incr(`${PREFIX}:color:${id}:attempts`))
        if (answer[index] === id) {
          writes.push(redis.incr(`${PREFIX}:color:${id}:correct`))
        }

        const picked = answer[index]
        writes.push(redis.incr(`${PREFIX}:pick:${index}:${picked}`))
      })

      getPairMistakes(answer).forEach((key) => {
        writes.push(redis.incr(`${PREFIX}:pair:${key}`))
      })
    }

    await Promise.all(writes)

    return readStats()
  } catch {
    memory.players.add(playerId)
    memory.attempts += 1
    memory.correct += isCorrect ? 1 : 0
    recordMemoryColorStats(answer, score)
    return readMemoryStats()
  }
}

function getRedis() {
  const url =
    process.env.UPSTASH_REDIS_REST_URL ??
    process.env.UPSTASH_REDIS_KV_REST_API_URL ??
    process.env.KV_REST_API_URL
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ??
    process.env.UPSTASH_REDIS_KV_REST_API_TOKEN ??
    process.env.KV_REST_API_TOKEN

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
    stringHits: memory.stringHits,
    colors: memory.colors,
    hitDistribution: memory.hitDistribution,
    firstPicks: memory.firstPicks,
    lastPicks: memory.lastPicks,
    pickOrder: memory.pickOrder,
    pairMistakes: memory.pairMistakes,
  }
}

async function readRedisColorStats(redis) {
  const entries = await Promise.all(
    ANSWER.map(async (id) => {
      const [attempts, correct] = await Promise.all([
        redis.get(`${PREFIX}:color:${id}:attempts`),
        redis.get(`${PREFIX}:color:${id}:correct`),
      ])

      return [id, { attempts: toNumber(attempts), correct: toNumber(correct) }]
    }),
  )

  return Object.fromEntries(entries)
}

async function readRedisColorCounts(redis, key) {
  const entries = await Promise.all(
    ANSWER.map(async (id) => {
      const count = await redis.get(`${PREFIX}:${key}:${id}`)
      return [id, toNumber(count)]
    }),
  )

  return Object.fromEntries(entries)
}

async function readRedisHitDistribution(redis) {
  return Promise.all(
    createEmptyHitDistribution().map(async (_, hits) => {
      const count = await redis.get(`${PREFIX}:hit:${hits}`)
      return toNumber(count)
    }),
  )
}

async function readRedisPickOrder(redis) {
  return Promise.all(
    ANSWER.map(async (_, index) => {
      const entries = await Promise.all(
        ANSWER.map(async (id) => {
          const count = await redis.get(`${PREFIX}:pick:${index}:${id}`)
          return [id, toNumber(count)]
        }),
      )

      return Object.fromEntries(entries)
    }),
  )
}

async function readRedisPairMistakes(redis) {
  const entries = await Promise.all(
    getAllPairKeys().map(async (key) => {
      const count = await redis.get(`${PREFIX}:pair:${key}`)
      return [key, toNumber(count)]
    }),
  )

  return Object.fromEntries(entries.filter(([, count]) => count > 0))
}

function recordMemoryColorStats(answer, score) {
  if (answer.length === 0) return

  memory.stringHits += score
  memory.hitDistribution[score] += 1
  memory.firstPicks[answer[0]] += 1
  memory.lastPicks[answer[ANSWER.length - 1]] += 1

  ANSWER.forEach((id, index) => {
    memory.colors[id].attempts += 1
    memory.colors[id].correct += answer[index] === id ? 1 : 0
    memory.pickOrder[index][answer[index]] += 1
  })

  getPairMistakes(answer).forEach((key) => {
    memory.pairMistakes[key] = (memory.pairMistakes[key] ?? 0) + 1
  })
}

function createEmptyColorStats() {
  return Object.fromEntries(ANSWER.map((id) => [id, { attempts: 0, correct: 0 }]))
}

function createEmptyColorCounts() {
  return Object.fromEntries(ANSWER.map((id) => [id, 0]))
}

function createEmptyPickOrder() {
  return ANSWER.map(() => createEmptyColorCounts())
}

function createEmptyHitDistribution() {
  return Array(ANSWER.length + 1).fill(0)
}

function sanitizeAnswer(value) {
  if (!Array.isArray(value)) return []
  if (value.length !== ANSWER.length) return []

  const answer = value.filter((id) => ANSWER.includes(id))
  const unique = new Set(answer)

  return answer.length === ANSWER.length && unique.size === ANSWER.length ? answer : []
}

function isPerfect(answer) {
  return ANSWER.every((id, index) => answer[index] === id)
}

function getSlotHits(answer) {
  return ANSWER.reduce((total, id, index) => total + (answer[index] === id ? 1 : 0), 0)
}

function getPairMistakes(answer) {
  const seen = new Set()

  ANSWER.forEach((expected, index) => {
    const actual = answer[index]
    if (!actual || actual === expected) return

    const actualHomeIndex = ANSWER.indexOf(actual)
    if (actualHomeIndex === -1 || answer[actualHomeIndex] !== expected) return

    seen.add(createPairKey(expected, actual))
  })

  return [...seen]
}

function getAllPairKeys() {
  const keys = []

  ANSWER.forEach((first, firstIndex) => {
    ANSWER.slice(firstIndex + 1).forEach((second) => {
      keys.push(createPairKey(first, second))
    })
  })

  return keys
}

function createPairKey(first, second) {
  return [first, second].sort((a, b) => ANSWER.indexOf(a) - ANSWER.indexOf(b)).join(':')
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
