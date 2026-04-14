import { join, dirname } from 'path'
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { app } from 'electron'
import { DATA_DIR_NAME } from '../appBrand'

class NotesService {
  private notesDir: string

  constructor() {
    this.notesDir = join(app.getPath('home'), DATA_DIR_NAME, 'notes')
  }

  private notePath(worktreeId: string): string {
    return join(this.notesDir, `${worktreeId}.md`)
  }

  load(worktreeId: string): string {
    try {
      return readFileSync(this.notePath(worktreeId), 'utf-8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return ''
      throw err
    }
  }

  save(worktreeId: string, content: string): void {
    const filePath = this.notePath(worktreeId)
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, content, 'utf-8')
  }

  delete(worktreeId: string): void {
    try {
      rmSync(this.notePath(worktreeId), { force: true })
    } catch {
      // Swallow — file may already be gone
    }
  }
}

export const notesService = new NotesService()
