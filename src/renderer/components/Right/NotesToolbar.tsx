import { memo } from 'react'
import type { Editor } from '@tiptap/react'
import { useTranslation } from 'react-i18next'
import {
  IconBold, IconItalic, IconStrikethrough, IconCodeBrackets,
  IconHeading, IconListBullet, IconListOrdered, IconTaskList,
  IconBlockquote, IconCodeBlock, IconHorizontalRule,
  IconUndo, IconRedo, IconTrash, IconImage,
} from '@/components/shared/icons'

interface Props {
  editor: Editor
  onClear: () => void
  onInsertImage: () => void
  saveStatus: 'idle' | 'saving' | 'saved'
  isLoading: boolean
}

const ICON_SIZE = 13
const HEADING_LEVELS = [1, 2, 3] as const

function ToolbarButton({
  active, disabled, onClick, title, children,
}: {
  active?: boolean; disabled?: boolean
  onClick: () => void; title: string
  children: React.ReactNode
}) {
  return (
    <button
      className={`notes-tb-btn${active ? ' notes-tb-btn--active' : ''}`}
      onClick={onClick}
      title={title}
      disabled={disabled}
      aria-pressed={active}
    >
      {children}
    </button>
  )
}

export const NotesToolbar = memo(function NotesToolbar({ editor, onClear, onInsertImage, saveStatus, isLoading }: Props) {
  const { t } = useTranslation('right')

  return (
    <div className="notes-toolbar">
      <div className="notes-tb-group">
        {HEADING_LEVELS.map((level) => (
          <ToolbarButton
            key={level}
            active={editor.isActive('heading', { level })}
            onClick={() => editor.chain().focus().toggleHeading({ level }).run()}
            title={t(`notesH${level}` as const)}
          >
            <IconHeading size={ICON_SIZE} />
            <span className="notes-tb-level">{level}</span>
          </ToolbarButton>
        ))}

        <span className="notes-tb-divider" />

        <ToolbarButton
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
          title={t('notesBold')}
        >
          <IconBold size={ICON_SIZE} />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          title={t('notesItalic')}
        >
          <IconItalic size={ICON_SIZE} />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive('strike')}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          title={t('notesStrike')}
        >
          <IconStrikethrough size={ICON_SIZE} />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive('code')}
          onClick={() => editor.chain().focus().toggleCode().run()}
          title={t('notesCode')}
        >
          <IconCodeBrackets size={ICON_SIZE} />
        </ToolbarButton>

        <span className="notes-tb-divider" />

        <ToolbarButton
          active={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          title={t('notesBulletList')}
        >
          <IconListBullet size={ICON_SIZE} />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          title={t('notesOrderedList')}
        >
          <IconListOrdered size={ICON_SIZE} />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive('taskList')}
          onClick={() => editor.chain().focus().toggleTaskList().run()}
          title={t('notesTaskList')}
        >
          <IconTaskList size={ICON_SIZE} />
        </ToolbarButton>

        <span className="notes-tb-divider" />

        <ToolbarButton
          active={editor.isActive('blockquote')}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          title={t('notesBlockquote')}
        >
          <IconBlockquote size={ICON_SIZE} />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive('codeBlock')}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          title={t('notesCodeBlock')}
        >
          <IconCodeBlock size={ICON_SIZE} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          title={t('notesHorizontalRule')}
        >
          <IconHorizontalRule size={ICON_SIZE} />
        </ToolbarButton>
        <ToolbarButton
          onClick={onInsertImage}
          title={t('notesInsertImage')}
        >
          <IconImage size={ICON_SIZE} />
        </ToolbarButton>
      </div>

      <div className="notes-tb-right">
        <ToolbarButton
          disabled={!editor.can().undo()}
          onClick={() => editor.chain().focus().undo().run()}
          title={t('notesUndo')}
        >
          <IconUndo size={ICON_SIZE} />
        </ToolbarButton>
        <ToolbarButton
          disabled={!editor.can().redo()}
          onClick={() => editor.chain().focus().redo().run()}
          title={t('notesRedo')}
        >
          <IconRedo size={ICON_SIZE} />
        </ToolbarButton>

        <span className="notes-tb-divider" />

        {saveStatus !== 'idle' && (
          <span className={`notes-save-status${saveStatus === 'saved' ? ' notes-save-status--saved' : ''}`}>
            {saveStatus === 'saving' ? t('notesSaving') : t('notesSaved')}
          </span>
        )}
        <ToolbarButton
          onClick={onClear}
          disabled={isLoading}
          title={t('notesClear')}
        >
          <IconTrash size={ICON_SIZE} />
        </ToolbarButton>
      </div>
    </div>
  )
})
