import { App, Plugin, TFile, PluginSettingTab, Setting, Notice } from 'obsidian'

interface AutoIdPluginSettings {
    prefix: string
    separator: string
    idLength: number
    excludePatterns: string[]
}

const DEFAULT_SETTINGS: AutoIdPluginSettings = {
    prefix: '@',
    separator: '--',
    idLength: 8,
    excludePatterns: [
        '*_',
        '_*',
        '*__*',
        '*--*',
        '*~~*'
    ]
}

const INVALID_CHARS = /[\\/:*?"<>|]/

export default class AutoIdPlugin extends Plugin {
    settings: AutoIdPluginSettings

    async onload() {
        await this.loadSettings()
        this.addSettingTab(new AutoIdSettingTab(this.app, this))

        this.registerEvent(
            this.app.vault.on('create', async (file) => {
                if (!(file instanceof TFile)) return
                await this.processNewFile(file)
            })
        )

        this.registerEvent(
            this.app.vault.on('rename', async (file, oldPath) => {
                if (!(file instanceof TFile)) return
                await this.processRenamedFile(file, oldPath)
            })
        )
    }

    private shouldExcludeFile(fileName: string): boolean {
        const hasExcludePattern = this.settings.excludePatterns.some(pattern => {
            const regexPattern = pattern
                .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
                .replace(/\*/g, '.*')
            const regex = new RegExp(regexPattern)
            return regex.test(fileName)
        })

        const surroundingPattern = /^.*?(__[^_]+__|--[^-]+--|~~[^~]+~~).*$/
        const hasSurroundingPattern = surroundingPattern.test(fileName)

        return hasExcludePattern || hasSurroundingPattern
    }

    async processNewFile(file: TFile) {
        const fileName = file.basename
        
        if (!fileName.startsWith(this.settings.prefix)) return
        if (this.shouldExcludeFile(fileName)) return
        if (!this.isValidFileName(fileName)) {
            new Notice('파일 이름에 허용되지 않는 문자가 포함되어 있습니다.')
            return
        }
        if (this.hasId(fileName)) return

        const newName = await this.generateUniqueFileName(fileName)
        await this.renameFile(file, newName)
    }

    async processRenamedFile(file: TFile, oldPath: string) {
        const fileName = file.basename

        if (!fileName.startsWith(this.settings.prefix)) return
        if (this.shouldExcludeFile(fileName)) return
        if (!this.isValidFileName(fileName)) {
            new Notice('파일 이름에 허용되지 않는 문자가 포함되어 있습니다.')
            return
        }
        if (this.hasId(fileName)) return

        const oldFileName = oldPath.split('/').pop()?.split('.').shift() || ''
        const oldId = this.extractId(oldFileName)
        
        if (oldId) {
            const newName = `${fileName}${this.settings.separator}${oldId}`
            await this.renameFile(file, newName)
        } else { 
            const newName = await this.generateUniqueFileName(fileName)
            await this.renameFile(file, newName)
        }
    }

    private async generateUniqueFileName(baseName: string): Promise<string> {
        const id = this.generateId()
        return `${baseName}${this.settings.separator}${id}`
    }

    private async renameFile(file: TFile, newBaseName: string) {
        try {
            const newPath = `${file.parent?.path || ''}/${newBaseName}.${file.extension}`
            await this.app.fileManager.renameFile(file, newPath)
        } catch (error) {
            new Notice(`파일 이름 변경 중 오류가 발생했습니다: ${error}`)
        }
    }

    private isValidFileName(fileName: string): boolean {
        return !INVALID_CHARS.test(fileName)
    }

    private hasId(fileName: string): boolean {
        const escapedSeparator = this.settings.separator.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')
        const idPattern = new RegExp(`${escapedSeparator}[a-z0-9]{${this.settings.idLength}}$`)
        return idPattern.test(fileName)
    }

    private extractId(fileName: string): string | null {
        const escapedSeparator = this.settings.separator.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')
        const match = fileName.match(new RegExp(`${escapedSeparator}([a-z0-9]{${this.settings.idLength}})$`))
        return match ? match[1] : null
    }

    generateId(): string {
        const timestamp = Date.now().toString(36)
        const randomPart = Math.random().toString(36).substring(2)
        const uniqueString = timestamp + randomPart
        return uniqueString.substring(0, this.settings.idLength)
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
    }

    async saveSettings() {
        await this.saveData(this.settings)
    }
} 

class AutoIdSettingTab extends PluginSettingTab {
    plugin: AutoIdPlugin

    constructor(app: App, plugin: AutoIdPlugin) {
        super(app, plugin)
        this.plugin = plugin
    }

    display(): void {
        const {containerEl} = this
        containerEl.empty()

        new Setting(containerEl)
            .setName('파일 머릿말')
            .setDesc('자동 ID를 추가할 파일의 시작 문자를 지정합니다.')
            .addText(text => text
                .setValue(this.plugin.settings.prefix)
                .onChange(async (value) => {
                    this.plugin.settings.prefix = value
                    await this.plugin.saveSettings()
                })
            )

        new Setting(containerEl)
            .setName('구분자')
            .setDesc('파일명과 ID 사이의 구분자를 지정합니다.')
            .addText(text => text
                .setValue(this.plugin.settings.separator)
                .onChange(async (value) => {
                    if (INVALID_CHARS.test(value)) {
                        new Notice('허용되지 않는 문자가 포함되어 있습니다.')
                        return
                    }
                    this.plugin.settings.separator = value
                    await this.plugin.saveSettings()
                })
            )

        new Setting(containerEl)
            .setName('ID 길이')
            .setDesc('생성될 ID의 길이를 지정합니다.')
            .addSlider(slider => slider
                .setLimits(4, 16, 1)
                .setValue(this.plugin.settings.idLength)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.idLength = value
                    await this.plugin.saveSettings()
                })
            )
        

        new Setting(containerEl)
            .setName('제외 패턴')
            .setDesc('자동 ID를 생성하지 않을 파일 이름 패턴을 지정합니다. 와일드카드(*) 사용 가능')
        
        const patternsContainer = containerEl.createDiv()
        this.plugin.settings.excludePatterns.forEach((pattern, index) => {
            new Setting(patternsContainer)
                .setName(`패턴 ${index + 1}`)
                .addText(text => text
                    .setValue(pattern)
                    .onChange(async (value) => {
                        this.plugin.settings.excludePatterns[index] = value
                        await this.plugin.saveSettings()
                    })
                )
                .addExtraButton((btn) => btn
                        .setIcon('trash')
                        .setTooltip('패턴 삭제')
                        .onClick(async () => {
                            this.plugin.settings.excludePatterns.splice(index, 1)
                            await this.plugin.saveSettings();
                            this.display()
                        })
                )
        })

        new Setting(containerEl)
        .addButton(btn => btn
            .setButtonText('패턴 추가')
            .onClick(async () => {
                this.plugin.settings.excludePatterns.push('')
                await this.plugin.saveSettings()
                this.display()
            })
        )    
    }
}