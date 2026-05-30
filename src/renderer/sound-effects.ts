import { ElMessage } from 'element-plus'
import clickSound from './assets/click.wav'
import successSound from './assets/success.wav'

type SuccessArgs = Parameters<typeof ElMessage.success>

let clickAudio: HTMLAudioElement | null = null
let successAudio: HTMLAudioElement | null = null
let installed = false

function play(src: string, volume: number): void {
  try {
    const audio = new Audio(src)
    audio.volume = volume
    void audio.play()
  } catch {
    // 音效失败不影响正常操作。
  }
}

export function playClickSound(): void {
  try {
    clickAudio?.pause()
    clickAudio = new Audio(clickSound)
    clickAudio.volume = 0.45
    void clickAudio.play()
  } catch {
    play(clickSound, 0.45)
  }
}

export function playSuccessSound(): void {
  try {
    successAudio?.pause()
    successAudio = new Audio(successSound)
    successAudio.volume = 0.8
    void successAudio.play()
  } catch {
    play(successSound, 0.8)
  }
}

function isClickableElement(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false

  const clickable = target.closest(
    'button, a, [role="button"], .el-button, .el-switch, .el-checkbox, .el-radio, .el-select, .el-input__wrapper, .el-dialog__close, .el-drawer__close-btn'
  )

  if (!clickable) return false
  if (clickable instanceof HTMLButtonElement && clickable.disabled) return false
  if (clickable.getAttribute('aria-disabled') === 'true') return false
  if (clickable.classList.contains('is-disabled')) return false

  return true
}

export function installSoundEffects(): void {
  if (installed) return
  installed = true

  document.addEventListener(
    'click',
    (event) => {
      if (isClickableElement(event.target)) {
        playClickSound()
      }
    },
    true
  )

  const originalSuccess = ElMessage.success.bind(ElMessage)
  ElMessage.success = ((...args: SuccessArgs) => {
    playSuccessSound()
    return originalSuccess(...args)
  }) as typeof ElMessage.success
}
