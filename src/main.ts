import './style.css'

type BallId = 'gold' | 'red' | 'black' | 'green' | 'purple' | 'silver'
type Locale = 'ja' | 'en'

type StringSpec = {
  id: BallId
  stringNo: number
  note: string
  hex: string
  colorName: Record<Locale, string>
}

type Stats = {
  players: number
  attempts: number
  correct: number
}

type GameState = {
  locale: Locale
  slots: Array<BallId | null>
  pool: BallId[]
  status: 'playing' | 'result'
  result: boolean | null
  stats: Stats
  isSaving: boolean
}

const STRINGS: StringSpec[] = [
  { id: 'gold', stringNo: 6, note: 'E', hex: '#c99a2e', colorName: { ja: 'ゴールド', en: 'Gold' } },
  { id: 'red', stringNo: 5, note: 'A', hex: '#d71920', colorName: { ja: 'レッド', en: 'Red' } },
  { id: 'black', stringNo: 4, note: 'D', hex: '#151515', colorName: { ja: 'ブラック', en: 'Black' } },
  { id: 'green', stringNo: 3, note: 'G', hex: '#18894f', colorName: { ja: 'グリーン', en: 'Green' } },
  { id: 'purple', stringNo: 2, note: 'B', hex: '#6f3da8', colorName: { ja: 'パープル', en: 'Purple' } },
  { id: 'silver', stringNo: 1, note: 'E', hex: '#c9ced3', colorName: { ja: 'シルバー', en: 'Silver' } },
]

const ANSWER = STRINGS.map((string) => string.id)
const STATS_KEY = 'daddario-ballend-game:stats:v1'
const PLAYER_KEY = 'daddario-ballend-game:player:v1'
const PLAYED_KEY = 'daddario-ballend-game:played:v1'
const LOCALE_KEY = 'daddario-ballend-game:locale:v1'
const EMPTY_STATS: Stats = { players: 0, attempts: 0, correct: 0 }

const copy = {
  ja: {
    title: 'ギタリストがなぜか正解できる並べ替えゲーム',
    order: '6弦 -> 1弦',
    pool: 'BALL ENDS',
    submit: '鳴らす',
    again: 'もう一度',
    correct: '正解',
    wrong: '残念',
    you: 'YOU',
    answer: 'ANSWER',
    stats: {
      players: '人数',
      attempts: '挑戦',
      correct: '正解',
      rate: '率',
    },
    aria: {
      locale: '言語',
      pool: 'シャッフルされたボールエンド',
      board: '6弦から1弦までの回答枠',
      remove: '枠から戻す',
      place: '次の枠に置く',
    },
  },
  en: {
    title: 'The Ball-End Sort Guitarists Somehow Know',
    order: '6th -> 1st',
    pool: 'BALL ENDS',
    submit: 'Ring it',
    again: 'Again',
    correct: 'Correct',
    wrong: 'Missed',
    you: 'YOU',
    answer: 'ANSWER',
    stats: {
      players: 'Players',
      attempts: 'Plays',
      correct: 'Hits',
      rate: 'Rate',
    },
    aria: {
      locale: 'Language',
      pool: 'Shuffled ball ends',
      board: 'Answer slots from sixth string to first string',
      remove: 'Return this ball end',
      place: 'Place this ball end in the next slot',
    },
  },
} satisfies Record<Locale, unknown>

const appRoot = document.querySelector<HTMLDivElement>('#app')

if (!appRoot) {
  throw new Error('App root was not found.')
}

const app = appRoot

const state: GameState = {
  locale: getInitialLocale(),
  slots: createEmptySlots(),
  pool: shuffleAnswer(),
  status: 'playing',
  result: null,
  stats: readLocalStats(),
  isSaving: false,
}

render()
loadStats().then((stats) => {
  state.stats = stats
  render()
})

app.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof Element)) return

  const button = target.closest<HTMLButtonElement>('button[data-action]')
  if (!button || button.disabled) return

  const action = button.dataset.action

  if (action === 'place') {
    const id = button.dataset.id
    if (isBallId(id)) {
      placeBall(id)
    }
  }

  if (action === 'remove') {
    const index = Number(button.dataset.index)
    if (Number.isInteger(index)) {
      removeBall(index)
    }
  }

  if (action === 'primary') {
    handlePrimaryAction()
  }
})

app.addEventListener('change', (event) => {
  const target = event.target
  if (!(target instanceof HTMLSelectElement) || target.name !== 'locale') return
  if (!isLocale(target.value)) return

  state.locale = target.value
  storageSet(LOCALE_KEY, target.value)
  render()
})

function render() {
  const text = copy[state.locale]
  const isComplete = state.slots.every(Boolean)
  const mainButtonLabel = state.status === 'playing' ? text.submit : text.again
  const mainButtonDisabled = state.status === 'playing' && (!isComplete || state.isSaving)

  app.innerHTML = `
    <main class="shell">
      <header class="topbar">
        <p class="brand">D'Addario Ball End</p>
        <select class="locale" name="locale" aria-label="${text.aria.locale}">
          <option value="ja" ${state.locale === 'ja' ? 'selected' : ''}>JP</option>
          <option value="en" ${state.locale === 'en' ? 'selected' : ''}>EN</option>
        </select>
      </header>

      <section class="hero" aria-labelledby="game-title">
        <h1 id="game-title">${text.title}</h1>
        <p class="order-label">${text.order}</p>
      </section>

      <section class="stats" aria-label="Stats">
        ${statItem(text.stats.players, state.stats.players)}
        ${statItem(text.stats.attempts, state.stats.attempts)}
        ${statItem(text.stats.correct, state.stats.correct)}
        ${statItem(text.stats.rate, `${getRate(state.stats)}%`)}
      </section>

      <section class="board" aria-label="${text.aria.board}">
        ${state.slots.map((id, index) => slotMarkup(id, index)).join('')}
      </section>

      ${
        state.status === 'playing'
          ? `
            <section class="pool-wrap" aria-label="${text.aria.pool}">
              <p class="section-kicker">${text.pool}</p>
              <div class="pool">
                ${availableBalls().map((id) => poolButtonMarkup(id)).join('')}
              </div>
            </section>
          `
          : resultMarkup()
      }

      <button class="primary" type="button" data-action="primary" ${mainButtonDisabled ? 'disabled' : ''}>
        ${mainButtonLabel}
      </button>
    </main>
  `
}

function statItem(label: string, value: string | number) {
  return `
    <div class="stat">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `
}

function slotMarkup(id: BallId | null, index: number) {
  const string = STRINGS[index]
  const label = `${string.stringNo}${state.locale === 'ja' ? '弦' : getOrdinalSuffix(string.stringNo)} ${string.note}`
  const colorText = id ? getString(id).colorName[state.locale] : ''
  const canRemove = Boolean(id && state.status === 'playing')
  const aria = id
    ? `${label} ${colorText}${canRemove ? `. ${copy[state.locale].aria.remove}` : ''}`
    : label

  return `
    <button
      class="slot ${id ? 'is-filled' : ''}"
      type="button"
      data-action="remove"
      data-index="${index}"
      aria-label="${aria}"
      ${canRemove ? '' : 'disabled'}
    >
      <span class="slot-label">${label}</span>
      ${id ? ballVisualMarkup(id, 'slot-ball') : '<span class="slot-empty" aria-hidden="true"></span>'}
    </button>
  `
}

function poolButtonMarkup(id: BallId) {
  const string = getString(id)
  const aria = `${string.colorName[state.locale]} ${copy[state.locale].aria.place}`

  return `
    <button class="ball-button" type="button" data-action="place" data-id="${id}" aria-label="${aria}">
      ${ballVisualMarkup(id, 'pool-ball')}
    </button>
  `
}

function resultMarkup() {
  const text = copy[state.locale]
  const tone = state.result ? 'correct' : 'wrong'
  const rows = state.result
    ? answerRowMarkup(text.answer, ANSWER)
    : `${answerRowMarkup(text.you, state.slots.filter(isBallId))}${answerRowMarkup(text.answer, ANSWER)}`

  return `
    <section class="result result-${tone}" aria-live="polite">
      <h2>${state.result ? text.correct : text.wrong}</h2>
      <div class="result-rows">
        ${rows}
      </div>
    </section>
  `
}

function answerRowMarkup(label: string, ids: BallId[]) {
  return `
    <div class="answer-row">
      <span>${label}</span>
      <div class="answer-balls">
        ${ids.map((id) => ballVisualMarkup(id, 'answer-ball')).join('')}
      </div>
    </div>
  `
}

function ballVisualMarkup(id: BallId, className: string) {
  const string = getString(id)
  const colorName = string.colorName[state.locale]

  return `
    <span
      class="ball ${className} ball-${id}"
      title="${colorName} ${string.hex}"
      aria-hidden="true"
    ></span>
  `
}

function placeBall(id: BallId) {
  if (state.status !== 'playing' || state.slots.includes(id)) return

  const index = state.slots.findIndex((slot) => slot === null)
  if (index === -1) return

  state.slots[index] = id
  render()
}

function removeBall(index: number) {
  if (state.status !== 'playing' || index < 0 || index >= state.slots.length) return

  state.slots[index] = null
  render()
}

function handlePrimaryAction() {
  if (state.status === 'result') {
    startRound()
    return
  }

  if (state.isSaving || !state.slots.every(Boolean)) return

  const isCorrect = ANSWER.every((id, index) => state.slots[index] === id)
  state.isSaving = true
  render()

  recordStats(isCorrect)
    .then((stats) => {
      state.stats = stats
    })
    .finally(() => {
      state.isSaving = false
      state.status = 'result'
      state.result = isCorrect
      render()
    })
}

function startRound() {
  state.slots = createEmptySlots()
  state.pool = shuffleAnswer()
  state.status = 'playing'
  state.result = null
  state.isSaving = false
  render()
}

function availableBalls() {
  return state.pool.filter((id) => !state.slots.includes(id))
}

function createEmptySlots() {
  return Array<BallId | null>(ANSWER.length).fill(null)
}

function shuffleAnswer(): BallId[] {
  const shuffled = [...ANSWER]

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]]
  }

  return ANSWER.every((id, index) => shuffled[index] === id) ? shuffleAnswer() : shuffled
}

function getString(id: BallId) {
  return STRINGS.find((string) => string.id === id) ?? STRINGS[0]
}

function getInitialLocale(): Locale {
  const saved = storageGet(LOCALE_KEY)
  if (isLocale(saved)) return saved
  return 'ja'
}

function isLocale(value: unknown): value is Locale {
  return value === 'ja' || value === 'en'
}

function isBallId(value: unknown): value is BallId {
  return ANSWER.includes(value as BallId)
}

function getOrdinalSuffix(value: number) {
  if (value === 1) return 'st'
  if (value === 2) return 'nd'
  if (value === 3) return 'rd'
  return 'th'
}

function getRate(stats: Stats) {
  if (stats.attempts === 0) return 0
  return Math.round((stats.correct / stats.attempts) * 100)
}

async function loadStats() {
  const apiStats = await requestStats('/api/stats')
  return apiStats ?? readLocalStats()
}

async function recordStats(isCorrect: boolean) {
  const playerId = getPlayerId()
  const localStats = recordLocalStats(isCorrect)
  const apiStats = await requestStats('/api/stats', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ correct: isCorrect, playerId }),
  })

  return apiStats ?? localStats
}

async function requestStats(url: string, init?: RequestInit): Promise<Stats | null> {
  if (!shouldUseStatsApi()) {
    return null
  }

  try {
    const response = await fetchWithTimeout(url, init)
    if (!response.ok) return null

    const payload: unknown = await response.json()
    if (!isStatsPayload(payload)) return null

    return normalizeStats(payload.stats)
  } catch {
    return null
  }
}

function shouldUseStatsApi() {
  const forced = import.meta.env.VITE_STATS_API === '1'
  const localHostnames = new Set(['localhost', '127.0.0.1', '0.0.0.0'])
  return forced || !localHostnames.has(window.location.hostname)
}

async function fetchWithTimeout(url: string, init?: RequestInit) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 700)

  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    window.clearTimeout(timeout)
  }
}

function isStatsPayload(value: unknown): value is { stats: Stats } {
  if (!value || typeof value !== 'object' || !('stats' in value)) return false
  return isStats((value as { stats: unknown }).stats)
}

function isStats(value: unknown): value is Stats {
  if (!value || typeof value !== 'object') return false
  const stats = value as Record<string, unknown>
  return ['players', 'attempts', 'correct'].every((key) => Number.isFinite(stats[key]))
}

function normalizeStats(stats: Stats): Stats {
  return {
    players: Math.max(0, Math.floor(stats.players)),
    attempts: Math.max(0, Math.floor(stats.attempts)),
    correct: Math.max(0, Math.floor(stats.correct)),
  }
}

function readLocalStats() {
  const raw = storageGet(STATS_KEY)
  if (!raw) return { ...EMPTY_STATS }

  try {
    const stats: unknown = JSON.parse(raw)
    return isStats(stats) ? normalizeStats(stats) : { ...EMPTY_STATS }
  } catch {
    return { ...EMPTY_STATS }
  }
}

function recordLocalStats(isCorrect: boolean) {
  const stats = readLocalStats()

  if (storageGet(PLAYED_KEY) !== '1') {
    stats.players += 1
    storageSet(PLAYED_KEY, '1')
  }

  stats.attempts += 1
  stats.correct += isCorrect ? 1 : 0
  storageSet(STATS_KEY, JSON.stringify(stats))

  return stats
}

function getPlayerId() {
  const saved = storageGet(PLAYER_KEY)
  if (saved) return saved

  const generated =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

  storageSet(PLAYER_KEY, generated)
  return generated
}

function storageGet(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function storageSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage can be unavailable in private or embedded contexts.
  }
}
