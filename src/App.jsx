import { useEffect, useMemo, useRef, useState } from 'react'
import * as Y from 'yjs'
import { WebrtcProvider } from 'y-webrtc'
import { timelineEvents } from './data/timelineEvents'
import './App.css'

const ACCESS_CODE = '1234'
const DEFAULT_ROOM = 'steam-ravens-fll-expedition'
const LANG_STORAGE_KEY = 'steam-ravens-lang-v1'

/** Narrow viewports: vertical stack + presenter lock ignored for viewers. */
function getIsPhoneViewport() {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(max-width: 640px)').matches
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function pickLang(value, lang) {
  if (value && typeof value === 'object' && ('es' in value || 'en' in value)) {
    return value[lang] ?? value.es ?? value.en ?? ''
  }
  return value ?? ''
}

function App() {
  const timelineTrackRef = useRef(null)
  const panelRefs = useRef([])
  const syncRef = useRef({
    doc: null,
    provider: null,
    map: null,
  })
  const [activeIndex, setActiveIndex] = useState(0)
  // Exploration is always available when presenter lock is off.
  const [showCodePrompt, setShowCodePrompt] = useState(false)
  const [isAdminUnlocked, setIsAdminUnlocked] = useState(false)
  const [isAdminOpen, setIsAdminOpen] = useState(false)
  const [codeInput, setCodeInput] = useState('')
  const [codeError, setCodeError] = useState('')
  const [isPresenterTakeover, setIsPresenterTakeover] = useState(false)
  const [headerLeft, setHeaderLeft] = useState(0)
  const [isSynced, setIsSynced] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [uploadNotice] = useState('')
  const [lang, setLang] = useState(() => {
    const saved = localStorage.getItem(LANG_STORAGE_KEY)
    if (saved === 'en' || saved === 'es') return saved
    return 'es'
  })
  const [isPhone, setIsPhone] = useState(getIsPhoneViewport)
  const isPhoneRef = useRef(isPhone)

  const ui = useMemo(() => {
    const dict = {
      es: {
        titleTop: 'Steam Ravens - Expedición de Innovación FLL',
        titleMain: 'Nuestro Viaje de Innovación',
        fullscreenEnter: 'Pantalla completa',
        fullscreenExit: 'Salir de pantalla completa',
        adminRequired: 'Acceso de presentador requerido',
        adminEnterCode: 'Ingresa el código de control',
        adminCodePlaceholder: 'Escribe el código',
        cancel: 'Cancelar',
        unlock: 'Desbloquear',
        wrongCode: 'Código incorrecto. Intenta de nuevo.',
        presenterPanel: 'Panel del Presentador',
        close: 'Cerrar',
        sync: 'Sincronización',
        syncOn: 'Activa',
        syncConnecting: 'Conectando...',
        activePanel: 'Panel activo',
        prev: 'Anterior',
        next: 'Siguiente',
        presenterLock: 'Bloqueo de control del presentador',
        judgesPreview: 'Vista previa de jueces',
        syncedToPanel: (n) => `Sincronizado exactamente al panel ${n}.`,
        progress: (i, total, phase) => `${i} de ${total}: ${phase}`,
        slot: (n) => `Espacio ${n}`,
        uploadHint: 'Sube foto, video o enlace',
        presenterLockPhoneNote:
          'En teléfonos el bloqueo no afecta a los visitantes: pueden desplazarse libremente.',
      },
      en: {
        titleTop: 'Steam Ravens - FLL Innovation Expedition',
        titleMain: 'Our Innovation Journey',
        fullscreenEnter: 'Fullscreen',
        fullscreenExit: 'Exit fullscreen',
        adminRequired: 'Presenter access required',
        adminEnterCode: 'Enter control code',
        adminCodePlaceholder: 'Type the code',
        cancel: 'Cancel',
        unlock: 'Unlock',
        wrongCode: 'Wrong code. Try again.',
        presenterPanel: 'Presenter Panel',
        close: 'Close',
        sync: 'Sync',
        syncOn: 'Live',
        syncConnecting: 'Connecting...',
        activePanel: 'Active panel',
        prev: 'Previous',
        next: 'Next',
        presenterLock: 'Presenter lock',
        judgesPreview: 'Judges preview',
        syncedToPanel: (n) => `Synced to panel ${n}.`,
        progress: (i, total, phase) => `${i} of ${total}: ${phase}`,
        slot: (n) => `Slot ${n}`,
        uploadHint: 'Add photo, video, or link',
        presenterLockPhoneNote:
          'On phones, presenter lock does not apply: viewers always scroll freely.',
      },
    }
    return dict[lang]
  }, [lang])

  const toggleLang = () => {
    setLang((prev) => {
      const next = prev === 'es' ? 'en' : 'es'
      localStorage.setItem(LANG_STORAGE_KEY, next)
      return next
    })
  }

  useEffect(() => {
    isPhoneRef.current = isPhone
  }, [isPhone])

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)')
    const onViewport = () => setIsPhone(mq.matches)
    onViewport()
    mq.addEventListener('change', onViewport)
    return () => mq.removeEventListener('change', onViewport)
  }, [])

  /** Reactive gradient inside GridX Expo panel (coords relative to that panel). */
  useEffect(() => {
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (motionQuery.matches) return undefined

    const gridxIndex = timelineEvents.findIndex((e) => e.id === 'gridx-expo')
    if (gridxIndex < 0) return undefined

    const applyPointer = (e) => {
      const el = panelRefs.current[gridxIndex]
      if (!el) return
      const r = el.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) return
      const x = Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100))
      const y = Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100))
      el.style.setProperty('--gx-x', `${x}%`)
      el.style.setProperty('--gx-y', `${y}%`)
    }

    window.addEventListener('pointermove', applyPointer, { passive: true })
    window.addEventListener('pointerdown', applyPointer, { passive: true })

    return () => {
      window.removeEventListener('pointermove', applyPointer)
      window.removeEventListener('pointerdown', applyPointer)
    }
  }, [])

  const currentEvent = useMemo(
    () => timelineEvents[activeIndex] ?? timelineEvents[0],
    [activeIndex],
  )
  /** Presenter lock never blocks scrolling on phones. */
  const canJudgeScroll = !isPresenterTakeover || isPhone
  const timelineProgress = (activeIndex / Math.max(timelineEvents.length - 1, 1)) * 100
  const syncRoom = useMemo(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('room') || DEFAULT_ROOM
  }, [])

  const publishState = (updates) => {
    const map = syncRef.current.map
    if (!map) return
    Object.entries(updates).forEach(([key, value]) => {
      map.set(key, value)
    })
    map.set('updatedAt', Date.now())
  }

  const canChangePanel = () =>
    !isPresenterTakeover || isAdminUnlocked || isPhone

  const requestPanelSnap = (index) => {
    if (!canChangePanel()) return
    syncToPanel(index)
    if (isPresenterTakeover && isAdminUnlocked) {
      publishState({ activeIndex: clamp(index, 0, timelineEvents.length - 1) })
    }
  }


  const updateHeaderPosition = (index = activeIndex) => {
    if (isPhoneRef.current) return
    const track = timelineTrackRef.current
    const panel = panelRefs.current[index]
    if (!track || !panel) return

    const center = panel.offsetLeft + panel.clientWidth / 2
    setHeaderLeft(center - track.scrollLeft)
  }

  const syncToPanel = (targetIndex, behavior = 'smooth') => {
    const nextIndex = clamp(targetIndex, 0, timelineEvents.length - 1)
    const target = panelRefs.current[nextIndex]
    const phone = isPhoneRef.current

    if (target) {
      target.scrollIntoView({
        behavior,
        block: phone ? 'start' : 'nearest',
        inline: phone ? 'nearest' : 'center',
      })
    }
    setActiveIndex(nextIndex)
    requestAnimationFrame(() => updateHeaderPosition(nextIndex))
  }

  const toggleFullscreen = async () => {
    const doc = document
    const root = document.documentElement

    try {
      if (!doc.fullscreenElement) {
        if (root.requestFullscreen) {
          await root.requestFullscreen()
        }
      } else if (doc.exitFullscreen) {
        await doc.exitFullscreen()
      }
    } catch {
      // Ignore fullscreen API errors on unsupported browsers.
    }
  }

  useEffect(() => {
    const doc = new Y.Doc()
    const provider = new WebrtcProvider(syncRoom, doc)
    const map = doc.getMap('presentation')

    syncRef.current = { doc, provider, map }

    const statusHandler = ({ status }) => {
      setIsSynced(status === 'connected')
    }

    provider.on('status', statusHandler)

    if (!map.has('activeIndex')) {
      map.set('activeIndex', 0)
      map.set('isFreeExplore', true)
      map.set('isPresenterTakeover', false)
      map.set('updatedAt', Date.now())
    }

    // Align initial view to current shared index.
    setActiveIndex(clamp(Number(map.get('activeIndex') ?? 0), 0, timelineEvents.length - 1))
    setIsPresenterTakeover(Boolean(map.get('isPresenterTakeover')))

    const observer = () => {
      const nextIndex = clamp(
        Number(map.get('activeIndex') ?? 0),
        0,
        timelineEvents.length - 1,
      )
      const nextPresenterLock = Boolean(map.get('isPresenterTakeover'))

      setIsPresenterTakeover(nextPresenterLock)

      // Only force-sync panels when presenter lock is enabled (never on phones).
      if (nextPresenterLock && !isPhoneRef.current) {
        setActiveIndex(nextIndex)
        requestAnimationFrame(() => syncToPanel(nextIndex, 'smooth'))
      } else {
        requestAnimationFrame(() => updateHeaderPosition(activeIndex))
      }
    }

    map.observe(observer)

    return () => {
      map.unobserve(observer)
      provider.off('status', statusHandler)
      provider.destroy()
      doc.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncRoom])

  useEffect(() => {
    if (!canJudgeScroll) syncToPanel(activeIndex, 'smooth')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canJudgeScroll])

  useEffect(() => {
    const onResize = () => updateHeaderPosition()
    window.addEventListener('resize', onResize)
    requestAnimationFrame(() => updateHeaderPosition())
    return () => {
      window.removeEventListener('resize', onResize)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex])

  useEffect(() => {
    if (!isPhone) {
      requestAnimationFrame(() => {
        const target = panelRefs.current[activeIndex]
        if (target) {
          target.scrollIntoView({
            behavior: 'auto',
            block: 'nearest',
            inline: 'center',
          })
        }
        updateHeaderPosition(activeIndex)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPhone])

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement))
    }

    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange)
    }
  }, [])

  const handleTrackScroll = () => {
    if (!timelineTrackRef.current) {
      return
    }
    if (!canJudgeScroll) return

    const track = timelineTrackRef.current

    if (isPhoneRef.current) {
      const viewportCenter = track.scrollTop + track.clientHeight / 2
      let nearestIndex = activeIndex
      let nearestDistance = Number.POSITIVE_INFINITY

      panelRefs.current.forEach((panel, index) => {
        if (!panel) return
        const center = panel.offsetTop + panel.clientHeight / 2
        const distance = Math.abs(center - viewportCenter)
        if (distance < nearestDistance) {
          nearestDistance = distance
          nearestIndex = index
        }
      })

      if (nearestIndex !== activeIndex) {
        setActiveIndex(nearestIndex)
      }
      return
    }

    const viewportCenter = track.scrollLeft + track.clientWidth / 2

    let nearestIndex = activeIndex
    let nearestDistance = Number.POSITIVE_INFINITY

    panelRefs.current.forEach((panel, index) => {
      if (!panel) return
      const center = panel.offsetLeft + panel.clientWidth / 2
      const distance = Math.abs(center - viewportCenter)
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearestIndex = index
      }
    })

    if (nearestIndex !== activeIndex) {
      setActiveIndex(nearestIndex)
    }
    updateHeaderPosition(nearestIndex)
  }

  const handleCodeSubmit = (event) => {
    event.preventDefault()
    if (codeInput === ACCESS_CODE) {
      setIsAdminUnlocked(true)
      setShowCodePrompt(false)
      setIsAdminOpen(true)
      setCodeError('')
      setCodeInput('')
      return
    }
    setCodeError(ui.wrongCode)
  }

  const adminMoveStep = (direction) => {
    const nextIndex = clamp(activeIndex + direction, 0, timelineEvents.length - 1)
    syncToPanel(nextIndex)
    publishState({ activeIndex: nextIndex })
  }

  const adminJumpTo = (index) => {
    const nextIndex = clamp(index, 0, timelineEvents.length - 1)
    syncToPanel(nextIndex)
    publishState({ activeIndex: nextIndex })
  }

  // isFreeExplore is now always true; exploration is controlled by presenter lock.

  const unlockEntryPoint = () => {
    if (isAdminUnlocked) {
      setIsAdminOpen((prev) => !prev)
      return
    }
    setShowCodePrompt(true)
    setCodeInput('')
    setCodeError('')
  }

  return (
    <main className={`expedition-app ${isPhone ? 'is-phone' : ''}`}>
      <div className="background-layer background-layer--gradient" />
      <div className="background-layer background-layer--dust" />
      <div className="background-layer background-layer--lines" />

      <section className={`timeline-stage ${isPhone ? 'is-phone' : ''}`}>
        <header
          className={`floating-title-panel ${isPhone ? 'floating-title-panel--phone' : ''}`}
          style={isPhone ? undefined : { left: `${headerLeft}px` }}
          onDoubleClick={unlockEntryPoint}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              unlockEntryPoint()
            }
          }}
          aria-label="Panel de título Steam Ravens"
        >
          <div className="floating-progress-timeline" aria-label="Progreso del tiempo">
            <div className="floating-progress-track">
              <div
                className="floating-progress-fill"
                style={{ width: `${timelineProgress}%` }}
              />
              <div className="floating-progress-stops" aria-hidden="true">
                {timelineEvents.map((event, index) => (
                  <button
                    key={`top-stop-${event.id}`}
                    type="button"
                    className={`floating-stop ${index <= activeIndex ? 'is-passed' : ''} ${index === activeIndex ? 'is-active' : ''} ${event.id === 'gridx-expo' ? 'floating-stop--flagship' : ''}`}
                    onClick={() => requestPanelSnap(index)}
                    disabled={!canChangePanel()}
                  />
                ))}
              </div>
            </div>
            <p className="floating-progress-label">
              {ui.progress(
                activeIndex + 1,
                timelineEvents.length,
                pickLang(currentEvent.phase, lang),
              )}
            </p>
          </div>
          <p className="eyebrow">{ui.titleTop}</p>
          <h1>{ui.titleMain}</h1>
        </header>

        <div
          ref={timelineTrackRef}
          className={`timeline-track ${isPhone ? 'is-vertical' : ''} ${canJudgeScroll ? 'is-free' : 'is-locked'}`}
          onScroll={handleTrackScroll}
        >
          {timelineEvents.map((event, index) => (
            <article
              key={event.id}
              ref={(node) => {
                panelRefs.current[index] = node
              }}
              className={`journey-panel ${index === activeIndex ? 'is-active' : ''} ${event.id === 'gridx-expo' ? 'journey-panel--gridx-expo' : ''}`}
              onClick={(eventClick) => {
                const target = eventClick.target
                if (!(target instanceof HTMLElement)) return
                if (target.closest('a, button, video, input, textarea, select, label')) return
                requestPanelSnap(index)
              }}
            >
              {event.id === 'gridx-expo' ? (
                <div className="gridx-expo-pointer-gradient" aria-hidden="true" />
              ) : null}
              <div className="panel-header">
                <p className="panel-meta">
                  {pickLang(event.phase, lang)} • {pickLang(event.date, lang)} •{' '}
                  {pickLang(event.location, lang)}
                </p>
                <h2>{pickLang(event.title, lang)}</h2>
              </div>

              <p className="panel-description">{pickLang(event.summary, lang)}</p>

              <div className="panel-media-grid">
                {Array.from({ length: 3 }, (_, slotIndex) => {
                  const item = event.media?.[slotIndex]
                  if (!item) {
                    return (
                      <div
                        key={`${event.id}-placeholder-${slotIndex + 1}`}
                        className="media-placeholder"
                      >
                        <strong>{ui.slot(slotIndex + 1)}</strong>
                        <span>{ui.uploadHint}</span>
                      </div>
                    )
                  }

                  if (item.type === 'image') {
                    return (
                      <figure key={item.src} className="media-card">
                        <img src={item.src} alt={pickLang(item.alt, lang)} loading="lazy" />
                        <figcaption>{pickLang(item.caption, lang)}</figcaption>
                      </figure>
                    )
                  }

                  if (item.type === 'video') {
                    return (
                      <figure key={item.src} className="media-card">
                        <video controls preload="metadata" poster={item.poster}>
                          <source src={item.src} type="video/mp4" />
                        </video>
                        <figcaption>{pickLang(item.caption, lang)}</figcaption>
                      </figure>
                    )
                  }

                  return (
                    <a
                      key={item.href ?? `${event.id}-link-${slotIndex + 1}`}
                      className="link-card"
                      href={item.href}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <strong>{pickLang(item.label, lang)}</strong>
                      <span>{pickLang(item.caption, lang)}</span>
                    </a>
                  )
                })}
              </div>

              <div
                className={`panel-text-grid ${event.id === 'gridx-expo' ? 'gridx-expo-impact-grid' : ''}`}
              >
                {(event.textBoxes ?? []).map((box, boxIndex) => (
                  <article
                    key={`${event.id}-text-box-${boxIndex + 1}`}
                    className={
                      event.id === 'gridx-expo'
                        ? `text-placeholder-panel gridx-expo-impact-card gridx-expo-impact-card--${boxIndex + 1}`
                        : 'text-placeholder-panel'
                    }
                  >
                    <h3>{pickLang(box.title, lang)}</h3>
                    <p>{pickLang(box.text, lang)}</p>
                  </article>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      {showCodePrompt && (
        <div className="overlay">
          <form className="code-modal" onSubmit={handleCodeSubmit}>
            <p className="status-label">{ui.adminRequired}</p>
            <h3>{ui.adminEnterCode}</h3>
            <input
              value={codeInput}
              onChange={(event) => setCodeInput(event.target.value)}
              placeholder={ui.adminCodePlaceholder}
              autoFocus
            />
            {codeError ? <p className="error-text">{codeError}</p> : null}
            <div className="modal-actions">
              <button
                type="button"
                onClick={() => setShowCodePrompt(false)}
                className="secondary"
              >
                {ui.cancel}
              </button>
              <button type="submit">{ui.unlock}</button>
            </div>
          </form>
        </div>
      )}

      <button
        type="button"
        className="fullscreen-button"
        onClick={toggleFullscreen}
      >
        {isFullscreen ? ui.fullscreenExit : ui.fullscreenEnter}
      </button>

      <button type="button" className="lang-button" onClick={toggleLang}>
        {lang === 'es' ? 'ENG' : 'ESP'}
      </button>

      {isAdminUnlocked && isAdminOpen && (
        <aside className="admin-drawer">
          <div className="admin-head">
            <h3>{ui.presenterPanel}</h3>
            <button type="button" onClick={() => setIsAdminOpen(false)}>
              {ui.close}
            </button>
          </div>

          <p className="sync-badge">
            {ui.sync}: {isSynced ? `${ui.syncOn} (${syncRoom})` : ui.syncConnecting}
          </p>
          {uploadNotice ? <p className="progress-meta">{uploadNotice}</p> : null}

          <label className="admin-select">
            {ui.activePanel}
            <select
              value={activeIndex}
              onChange={(event) => adminJumpTo(Number(event.target.value))}
            >
              {timelineEvents.map((event, index) => (
                <option key={event.id} value={index}>
                  {index + 1}. {pickLang(event.title, lang)}
                </option>
              ))}
            </select>
          </label>

          <div className="admin-buttons">
            <button
              type="button"
              onClick={() => adminMoveStep(-1)}
              disabled={activeIndex === 0}
            >
              {ui.prev}
            </button>
            <button
              type="button"
              onClick={() => adminMoveStep(1)}
              disabled={activeIndex === timelineEvents.length - 1}
            >
              {ui.next}
            </button>
          </div>

          <label className="admin-toggle">
            <span>{ui.presenterLock}</span>
            <button
              type="button"
              className={`toggle ${isPresenterTakeover ? 'on' : ''}`}
              onClick={() => {
                if (isPresenterTakeover) {
                  setIsPresenterTakeover(false)
                  publishState({ isPresenterTakeover: false })
                  return
                }

                // Enable lock and force everyone to this panel.
                setIsPresenterTakeover(true)
                publishState({
                  isPresenterTakeover: true,
                  activeIndex,
                })
              }}
              aria-pressed={isPresenterTakeover}
            >
              <span />
            </button>
          </label>
          {isPhone ? (
            <p className="phone-lock-note">{ui.presenterLockPhoneNote}</p>
          ) : null}

          <div className="preview-box">
            <p className="status-label">{ui.judgesPreview}</p>
            <p className="preview-title">{pickLang(currentEvent.title, lang)}</p>
            <p>{pickLang(currentEvent.summary, lang)}</p>
            <p className="preview-caption">
              {ui.syncedToPanel(activeIndex + 1)}
            </p>
          </div>
        </aside>
      )}

      <div className="floating-relics" aria-hidden="true">
        {[1, 2, 3, 4, 5, 6].map((relicIndex) => (
          <span
            key={`relic-${relicIndex}`}
            className="relic"
            style={{ '--relic-index': relicIndex }}
          />
        ))}
      </div>
    </main>
  )
}

export default App
