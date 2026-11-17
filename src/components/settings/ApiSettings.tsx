import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { ApiError } from '../../services/api/client.js'
import {
  PROVIDERS,
  endpointIssue,
  findProvider,
  resolveEndpoint,
} from '../../services/api/providers.js'
import { listModels, testConnection, type EndpointKind } from '../../services/models.js'
import { useIsMobile } from '../../app/viewport.js'
import { resolveRefPlan } from '../../services/image.js'
import type { ImageRefMode } from '../../services/settings.js'
import {
  createProfile,
  deleteProfile,
  renameProfile,
  setApiConfig,
  setChatParams,
  setImageConfig,
  setImageExtra,
  switchProfile,
  useSettings,
  type ApiProtocol,
} from '../../services/settings.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { IconEditOutline16, IconNewChatOutline20, IconTrashOutline16 } from '../base/icons.js'
import { Select } from '../base/Select.js'
import { showToast } from '../base/toastState.js'
import { ApiKeyConfirm, ApiKeyField, type ApiKeyEditor } from './ApiKeyField.js'
import styles from './Settings.module.css'

const PROTOCOL_OPTIONS: {
  value: ApiProtocol
  label: 'apiProtocolAnthropic' | 'apiProtocolOpenai'
}[] = [
  { value: 'anthropic', label: 'apiProtocolAnthropic' },
  { value: 'openai', label: 'apiProtocolOpenai' },
]

type Status = { tone: 'ok' | 'error'; text: string }

const describeError = (error: unknown, t: ReturnType<typeof useTranslate>): string => {
  if (error instanceof ApiError && error.localMessage) {
    return t(error.localMessage.key, error.localMessage.params)
  }
  return error instanceof Error && error.message ? error.message : String(error)
}

/**
 * 模型输入行：可直接填，也可以从接口拉取模型列表后选。
 * 附带「测试连接」：先试 /models，不支持该端点的服务再退回一次真实调用。
 */
const ModelField = ({
  kind,
  value,
  placeholder,
  onChange,
}: {
  kind: EndpointKind
  value: string
  placeholder: string
  onChange: (value: string) => void
}) => {
  const t = useTranslate()
  const [models, setModels] = useState<string[] | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState<'models' | 'test' | null>(null)

  const run = async (mode: 'models' | 'test') => {
    setBusy(mode)
    setStatus(null)
    try {
      if (mode === 'models') {
        const list = await listModels(kind)
        setModels(list)
        setStatus({ tone: 'ok', text: t('modelsFetched', { count: list.length }) })
      } else {
        await testConnection(kind)
        setStatus({ tone: 'ok', text: t('connectionOk') })
      }
    } catch (error) {
      setStatus({
        tone: 'error',
        text: t('connectionFailed', { message: describeError(error, t) }),
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className={styles.fieldBlock}>
      <input
        className={styles.input}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
      />
      {models && models.length > 0 ? (
        <Select
          value={value}
          options={models.map((item) => ({ value: item, label: item }))}
          onChange={onChange}
          placeholder={t('modelPick')}
          ariaLabel={t('modelPick')}
        />
      ) : null}
      <div className={styles.modelActions}>
        <Button
          variant="outlined"
          size="s"
          disabled={busy !== null}
          onClick={() => void run('models')}
        >
          {busy === 'models' ? t('fetchingModels') : t('fetchModels')}
        </Button>
        <Button
          variant="outlined"
          size="s"
          disabled={busy !== null}
          onClick={() => void run('test')}
        >
          {busy === 'test' ? t('testing') : t('testConnection')}
        </Button>
        {status ? (
          <span className={status.tone === 'ok' ? styles.statusOk : styles.statusError}>
            {status.text}
          </span>
        ) : null}
      </div>
    </div>
  )
}

/**
 * 接口设置：
 * - 对话接口：服务商预设 + 自定义（地址 / 模型 / 协议），Key 与预设放在一起更顺
 * - 生图接口：独立配置，留空则不启用
 */
export const ApiSettings = ({ editor }: { editor: ApiKeyEditor }) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const apiPreset = useSettings((state) => state.apiPreset)
  const apiBaseUrl = useSettings((state) => state.apiBaseUrl)
  const apiModel = useSettings((state) => state.apiModel)
  const apiProtocol = useSettings((state) => state.apiProtocol)
  const imageBaseUrl = useSettings((state) => state.imageBaseUrl)
  const imageModel = useSettings((state) => state.imageModel)
  const imageApiKey = useSettings((state) => state.imageApiKey)

  const profiles = useSettings((state) => state.profiles)
  const activeProfileId = useSettings((state) => state.activeProfileId)
  const chatParams = useSettings((state) => state.chatParams)
  const imageExtra = useSettings((state) => state.imageExtra)
  const imageRefMode = useSettings((state) => state.imageRefMode)
  const imagePath = useSettings((state) => state.imagePath)
  const [imagePathDraft, setImagePathDraft] = useState(imagePath)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [extraDraft, setExtraDraft] = useState(imageExtra)

  useEffect(() => {
    setExtraDraft(imageExtra)
  }, [imageExtra])

  useEffect(() => {
    setImagePathDraft(imagePath)
  }, [imagePath])

  const preset = findProvider(apiPreset)
  // 每次渲染重新算：用户改模型名后「实际生效的方式」要立刻跟着变
  const refPlan = resolveRefPlan()
  const endpoint = resolveEndpoint()
  const custom = apiPreset === 'custom'
  const protocol = apiProtocol || preset.protocol
  const issue = endpointIssue(endpoint)

  // 地址与 Key 用草稿，失焦才写回，避免每次按键都刷新全局状态
  const [baseDraft, setBaseDraft] = useState(apiBaseUrl)
  const [imageBaseDraft, setImageBaseDraft] = useState(imageBaseUrl)
  const [imageKeyDraft, setImageKeyDraft] = useState(imageApiKey)

  useEffect(() => {
    setBaseDraft(apiBaseUrl)
  }, [apiBaseUrl])

  useEffect(() => {
    setImageBaseDraft(imageBaseUrl)
    setImageKeyDraft(imageApiKey)
  }, [imageBaseUrl, imageApiKey])

  return (
    <>
      <div className={styles.cell}>
        <div className={styles.label}>{t('profileTitle')}</div>
        <div className={styles.fieldBlock}>
          <div className={styles.profileRow}>
            <Select
              value={activeProfileId}
              options={profiles.map((item) => ({ value: item.id, label: item.name }))}
              onChange={switchProfile}
              ariaLabel={t('profileTitle')}
            />
            <IconButton
              icon={<IconNewChatOutline20 />}
              tooltip={t('profileNew')}
              onClick={() => {
                createProfile(`${t('profileTitle')} ${profiles.length + 1}`)
                showToast({ key: 'profileCreated' })
              }}
            />
            <IconButton
              icon={<IconEditOutline16 />}
              tooltip={t('profileRename')}
              onClick={() => {
                const current = profiles.find((item) => item.id === activeProfileId)
                setNameDraft(current?.name ?? '')
                setRenaming(activeProfileId)
              }}
            />
            <IconButton
              icon={<IconTrashOutline16 />}
              tooltip={t('profileDelete')}
              disabled={profiles.length <= 1}
              onClick={() => {
                deleteProfile(activeProfileId)
                showToast({ key: 'profileDeleted' })
              }}
            />
          </div>
          {renaming ? (
            <input
              className={styles.input}
              value={nameDraft}
              autoFocus
              placeholder={t('profileNamePlaceholder')}
              onChange={(event) => setNameDraft(event.target.value)}
              onBlur={() => {
                if (nameDraft.trim()) {
                  renameProfile(renaming, nameDraft.trim())
                }
                setRenaming(null)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.currentTarget.blur()
                }
              }}
            />
          ) : null}
        </div>
      </div>

      <div className={styles.cell}>
        <div className={styles.label}>{t('apiProviderLabel')}</div>
        <div className={styles.description}>{t('apiProviderDesc')}</div>
        <div className={styles.fieldBlock}>
          <Select
            value={apiPreset}
            options={PROVIDERS.map((item) => ({ value: item.id, label: item.label }))}
            onChange={(value) => {
              // 换服务商时清掉覆盖项，直接用新预设的地址与模型
              setApiConfig({
                apiPreset: value,
                apiBaseUrl: '',
                apiModel: '',
                apiProtocol: '',
              })
            }}
            ariaLabel={t('apiProviderLabel')}
          />
        </div>
      </div>

      <div className={styles.cell}>
        <div className={styles.label}>{t('apiBaseUrlLabel')}</div>
        <div className={styles.fieldBlock}>
          <input
            className={styles.input}
            value={baseDraft}
            placeholder={preset.baseUrl || t('apiBaseUrlPlaceholder')}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setBaseDraft(event.target.value)}
            onBlur={() => setApiConfig({ apiBaseUrl: baseDraft.trim() })}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.currentTarget.blur()
              }
            }}
          />
          <div className={styles.description}>
            {custom
              ? t('apiCustomHint')
              : `${t('apiProtocolLabel')}：${t(
                  protocol === 'anthropic' ? 'apiProtocolAnthropic' : 'apiProtocolOpenai'
                )}`}
          </div>
        </div>
      </div>

      <div className={styles.cell}>
        <div className={styles.label}>{t('apiModelLabel')}</div>
        <ModelField
          kind="chat"
          value={apiModel}
          placeholder={preset.model || t('apiModelPlaceholder')}
          onChange={(value) => setApiConfig({ apiModel: value })}
        />
        {issue === 'apiBaseUrlMissing' ? (
          <div className={styles.statusError}>{t('apiBaseUrlMissing')}</div>
        ) : issue === 'apiModelMissing' ? (
          <div className={styles.statusError}>{t('apiModelMissing')}</div>
        ) : null}
      </div>

      {custom ? (
        <div className={styles.cell}>
          <div className={styles.label}>{t('apiProtocolLabel')}</div>
          <div className={styles.fieldBlock}>
            <Select
              value={protocol}
              options={PROTOCOL_OPTIONS.map((item) => ({
                value: item.value,
                label: t(item.label),
              }))}
              onChange={(value) => setApiConfig({ apiProtocol: value })}
              ariaLabel={t('apiProtocolLabel')}
            />
          </div>
        </div>
      ) : null}

      <ApiKeyField editor={editor} />
      {/* 移动端键盘会挡住确认按钮，单独放一个 */}
      {isMobile ? <ApiKeyConfirm editor={editor} /> : null}

      <div className={styles.cell}>
        <div className={styles.label}>{t('chatParamsTitle')}</div>
        <div className={styles.description}>{t('chatParamsHint')}</div>
        <div className={styles.paramsRow}>
          <label className={styles.paramField}>
            <span>{t('chatTemperature')}</span>
            <input
              className={styles.input}
              type="number"
              step={0.1}
              min={0}
              max={2}
              value={chatParams.temperature ?? ''}
              placeholder="1.0"
              onChange={(event) =>
                setChatParams({
                  temperature: event.target.value === '' ? undefined : Number(event.target.value),
                })
              }
            />
          </label>
          <label className={styles.paramField}>
            <span>{t('chatTopP')}</span>
            <input
              className={styles.input}
              type="number"
              step={0.05}
              min={0}
              max={1}
              value={chatParams.topP ?? ''}
              placeholder="1.0"
              onChange={(event) =>
                setChatParams({
                  topP: event.target.value === '' ? undefined : Number(event.target.value),
                })
              }
            />
          </label>
          <label className={styles.paramField}>
            <span>{t('chatMaxTokens')}</span>
            <input
              className={styles.input}
              type="number"
              step={256}
              min={1}
              value={chatParams.maxTokens ?? ''}
              placeholder="4096"
              onChange={(event) =>
                setChatParams({
                  maxTokens: event.target.value === '' ? undefined : Number(event.target.value),
                })
              }
            />
          </label>
        </div>
      </div>

      {endpoint.protocol === 'anthropic' && !endpoint.filesBase ? (
        <div className={styles.cell}>
          <div className={styles.description}>{t('apiNativeOnly')}</div>
        </div>
      ) : null}

      <div className={styles.cell}>
        <div className={styles.label}>{t('imageSectionTitle')}</div>
        <div className={styles.description}>{t('imageSectionDesc')}</div>
        <div className={styles.fieldBlock}>
          <input
            className={styles.input}
            value={imageBaseDraft}
            placeholder={t('apiBaseUrlPlaceholder')}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setImageBaseDraft(event.target.value)}
            onBlur={() =>
              setImageConfig({ imageBaseUrl: imageBaseDraft.trim().replace(/\/+$/, '') })
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.currentTarget.blur()
              }
            }}
          />
          <input
            className={styles.input}
            type="password"
            value={imageKeyDraft}
            placeholder={t('imageApiKeyPlaceholder')}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setImageKeyDraft(event.target.value)}
            onBlur={() => setImageConfig({ imageApiKey: imageKeyDraft.trim() })}
          />
        </div>
      </div>

      <div className={styles.cell}>
        <div className={styles.label}>{t('imageModelLabel')}</div>
        <ModelField
          kind="image"
          value={imageModel}
          placeholder={t('imageModelLabel')}
          onChange={(value) => setImageConfig({ imageModel: value })}
        />
      </div>

      <div className={styles.cell}>
        <div className={styles.label}>{t('imageRefModeLabel')}</div>
        <div className={styles.description}>{t('imageRefModeHint')}</div>
        <div className={styles.fieldBlock}>
          <Select
            value={imageRefMode}
            options={[
              { value: 'auto', label: t('imageRefModeAuto') },
              { value: 'image', label: t('imageRefModeImage') },
              { value: 'image-raw', label: t('imageRefModeImageRaw') },
              { value: 'image-url', label: t('imageRefModeImageUrl') },
              { value: 'images', label: t('imageRefModeImages') },
              { value: 'edits', label: t('imageRefModeEdits') },
              { value: 'off', label: t('imageRefModeOff') },
            ]}
            onChange={(value) => setImageConfig({ imageRefMode: value as ImageRefMode })}
            ariaLabel={t('imageRefModeLabel')}
          />
          <input
            className={styles.input}
            value={imagePathDraft}
            placeholder={t('imagePathHint')}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setImagePathDraft(event.target.value)}
            onBlur={() =>
              setImageConfig({
                imagePath: imagePathDraft.trim() ? imagePathDraft.trim() : '',
              })
            }
          />
          <div className={styles.description}>
            {t('imageRefModeEffective', {
              path: refPlan.url.replace(/^https?:\/\/[^/]+/, ''),
              mode: refPlan.mode,
            })}
          </div>
          {refPlan.maybeUnsupported ? (
            <div className={styles.statusError}>{t('imageRefWarnUnsupported')}</div>
          ) : null}
        </div>
      </div>

      <div className={styles.cell}>
        <div className={styles.label}>{t('imageExtraLabel')}</div>
        <div className={styles.description}>{t('imageExtraHint')}</div>
        <div className={styles.fieldBlock}>
          <textarea
            className={styles.textarea}
            rows={2}
            value={extraDraft}
            placeholder={t('imageExtraPlaceholder')}
            onChange={(event) => setExtraDraft(event.target.value)}
            onBlur={() => setImageExtra(extraDraft.trim())}
          />
        </div>
      </div>
    </>
  )
}
