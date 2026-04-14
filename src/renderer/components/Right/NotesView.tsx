import { useState, useEffect, useRef, useCallback } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Typography from '@tiptap/extension-typography'
import Image from '@tiptap/extension-image'
import { Markdown } from 'tiptap-markdown'
import type { MarkdownStorage } from 'tiptap-markdown'
import { useTranslation } from 'react-i18next'
import * as ipc from '@/lib/ipc'
import { NotesToolbar } from './NotesToolbar'

interface Props {
  worktreeId: string
}

type SaveStatus = 'idle' | 'saving' | 'saved'

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_IMAGE_DIMENSION = 1200
const IMAGE_QUALITY = 0.85

function getMarkdown(editor: ReturnType<typeof useEditor>): string {
  if (!editor) return ''
  return (editor.storage as { markdown?: MarkdownStorage }).markdown?.getMarkdown() ?? ''
}

/** Resize to MAX_IMAGE_DIMENSION on the longest side, re-encode as WebP. */
async function resizeAndEncodeImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    const objectUrl = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      const { naturalWidth: w, naturalHeight: h } = img
      const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(w, h))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(w * scale)
      canvas.height = Math.round(h * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('canvas 2d unavailable')); return }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/webp', IMAGE_QUALITY))
    }
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('image load failed')) }
    img.src = objectUrl
  })
}

export function NotesView({ worktreeId }: Props) {
  const { t } = useTranslation('right')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [isLoading, setIsLoading] = useState(true)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestWorktreeId = useRef(worktreeId)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Ref mirrors isLoading for use inside onUpdate (synchronous callback that
  // would otherwise close over a stale useState value).
  const isLoadingRef = useRef(true)

  const scheduleSave = useCallback((content: string, id: string) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    setSaveStatus('saving')
    saveTimerRef.current = setTimeout(async () => {
      await ipc.notes.save(id, content)
      if (latestWorktreeId.current === id) setSaveStatus('saved')
      saveTimerRef.current = null
    }, 500)
  }, [])

  const editor = useEditor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: t('notesEmpty') }),
      Typography,
      Image.configure({ inline: false, allowBase64: true }),
      Markdown.configure({ html: false, transformPastedText: true }),
    ],
    content: '',
    editorProps: {
      handlePaste: (view, event) => {
        const items = event.clipboardData?.items
        if (!items) return false
        for (const item of Array.from(items)) {
          if (item.type.startsWith('image/')) {
            const file = item.getAsFile()
            if (!file) continue
            if (file.size > MAX_IMAGE_BYTES) return true
            event.preventDefault()
            resizeAndEncodeImage(file).then((dataUrl) => {
              view.dispatch(
                view.state.tr.replaceSelectionWith(
                  view.state.schema.nodes.image.create({ src: dataUrl })
                )
              )
            })
            return true
          }
        }
        return false
      },
      handleDrop: (view, event) => {
        const files = event.dataTransfer?.files
        if (!files?.length) return false
        const imageFile = Array.from(files).find((f) => f.type.startsWith('image/'))
        if (!imageFile) return false
        if (imageFile.size > MAX_IMAGE_BYTES) return true
        event.preventDefault()
        const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })
        resizeAndEncodeImage(imageFile).then((dataUrl) => {
          const tr = view.state.tr
          const pos = coords?.pos ?? view.state.doc.content.size
          tr.insert(pos, view.state.schema.nodes.image.create({ src: dataUrl }))
          view.dispatch(tr)
        })
        return true
      },
    },
    onUpdate: ({ editor: ed }) => {
      if (isLoadingRef.current) return
      scheduleSave(getMarkdown(ed), latestWorktreeId.current)
    },
  })

  // useEditor returns null until async init completes — `editor` must be a dep
  // so we re-run when it becomes available.
  useEffect(() => {
    if (!editor) return
    latestWorktreeId.current = worktreeId
    isLoadingRef.current = true
    setIsLoading(true)
    setSaveStatus('idle')
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }

    ipc.notes.load(worktreeId).then((text: string) => {
      if (latestWorktreeId.current !== worktreeId) return
      editor.commands.setContent(text || '', { emitUpdate: false })
      isLoadingRef.current = false
      setIsLoading(false)
    }).catch(() => {
      if (latestWorktreeId.current !== worktreeId) return
      editor.commands.setContent('', { emitUpdate: false })
      isLoadingRef.current = false
      setIsLoading(false)
    })
  }, [worktreeId, editor])

  useEffect(() => () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
  }, [])

  const handleClear = useCallback(async () => {
    if (!editor) return
    if (!window.confirm(t('notesClearConfirm'))) return
    editor.commands.clearContent()
    setSaveStatus('idle')
    await ipc.notes.delete(latestWorktreeId.current)
  }, [editor, t])

  const handleInsertImage = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !editor) return
    e.target.value = ''
    if (!file.type.startsWith('image/')) return
    if (file.size > MAX_IMAGE_BYTES) return
    const dataUrl = await resizeAndEncodeImage(file)
    editor.chain().focus().setImage({ src: dataUrl }).run()
  }, [editor])

  return (
    <div className="notes-view">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      {editor && (
        <NotesToolbar
          editor={editor}
          onClear={handleClear}
          onInsertImage={handleInsertImage}
          saveStatus={saveStatus}
          isLoading={isLoading}
        />
      )}

      <div className="notes-editor-wrapper">
        {isLoading && (
          <div className="notes-loading">{t('loading')}</div>
        )}
        <EditorContent editor={editor} className="notes-editor" />
      </div>
    </div>
  )
}
