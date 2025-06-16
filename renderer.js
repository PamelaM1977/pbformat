const { ipcRenderer } = require('electron');

// --- Custom Quill Blots and Registration ---

// Spread Block Embed
class SpreadBlot extends Quill.import('blots/block/embed') {
    static create(value) {
        const node = super.create();
        node.setAttribute('data-spread', value);
        node.textContent = value;
        node.className = 'spread-label';
        node.setAttribute('contenteditable', 'false');
        return node;
    }
    static value(node) { return node.getAttribute('data-spread'); }
}
SpreadBlot.blotName = 'spread';
SpreadBlot.tagName = 'div';
Quill.register(SpreadBlot);

// Picture Book Format Block
const Block = Quill.import('blots/block');
class PBFormatBlot extends Block {
    static create(value) {
        const node = super.create();
        if (value) node.className = `pb-${value}`;
        return node;
    }
    static formats(node) {
        const classes = node.className.match(/pb-(\w+)/);
        return classes ? classes[1] : null;
    }
}
PBFormatBlot.blotName = 'pb-format';
PBFormatBlot.tagName = 'p';
Quill.register(PBFormatBlot);

// --- Spread Manager ---
class SpreadManager {
    constructor(quill, preferences) {
        this.quill = quill;
        this.firstSpreadNumber = preferences.firstDisplaySpreadPageNumber || 3;
        this.maxPages = preferences.layout || 32;
        this.updateSequence();
    }

    updateSequence() {
        this.spreadSequence = [];
        for (let i = 1; i <= this.maxPages; i++) {
            if (i === 1 || i === this.maxPages) {
                this.spreadSequence.push(i.toString());
            } else if (i % 2 === 0) {
                this.spreadSequence.push(`${i}-${i + 1}`);
                i++;
            }
        }
    }

    getNextSpreadLabel() {
        // Find all spread labels in doc
        const delta = this.quill.getContents();
        let used = [];
        delta.ops.forEach(op => {
            if (op.insert && op.insert.spread) used.push(op.insert.spread);
        });
        // Find first unused label after firstSpreadNumber
        let startIdx = this.spreadSequence.findIndex(lab => {
            if (lab.includes('-')) {
                const [a, b] = lab.split('-').map(Number);
                return a <= this.firstSpreadNumber && this.firstSpreadNumber <= b;
            }
            return Number(lab) === this.firstSpreadNumber;
        });
        if (startIdx === -1) startIdx = 0;
        for (let i = startIdx; i < this.spreadSequence.length; i++) {
            if (!used.includes(this.spreadSequence[i])) return this.spreadSequence[i];
        }
        return null;
    }

    addSpread() {
        const label = this.getNextSpreadLabel();
        if (!label) return;
        const selection = this.quill.getSelection();
        const index = selection ? selection.index : this.quill.getLength();
        this.quill.insertEmbed(index, 'spread', label, Quill.sources.USER);
        this.quill.insertText(index + 1, '\n', 'pb-format', 'default', Quill.sources.USER);
        this.quill.setSelection(index + 2, 0, Quill.sources.SILENT);
    }

    deleteSpread() {
        const selection = this.quill.getSelection();
        if (!selection) return;
        const [blot, offset] = this.quill.getLine(selection.index);
        if (blot && blot.domNode && blot.domNode.classList.contains('spread-label')) {
            // Remove the spread label block
            this.quill.deleteText(selection.index - offset, 1, Quill.sources.USER);
        }
    }
}

// --- Quill Initialization ---
let preferences = {
    layout: 32,
    firstDisplaySpreadPageNumber: 3
};
let spreadManager;

const quill = new Quill('#editor', {
    theme: 'snow',
    modules: {
        toolbar: {
            container: [
                [{ 'pb-format': ['default', 'illustration', 'title'] }],
                ['bold', 'italic', 'underline'],
                [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                ['clean']
            ],
            handlers: {
                'pb-format': function(value) {
                    const range = this.quill.getSelection();
                    if (range) this.quill.format('pb-format', value);
                }
            }
        }
    }
});

// --- SpreadManager instance ---
spreadManager = new SpreadManager(quill, preferences);

// --- Settings Panel Handlers ---
const firstSpreadInput = document.getElementById('firstSpreadNumber');
const layoutSelect = document.getElementById('layoutSelect');
firstSpreadInput.addEventListener('change', () => {
    preferences.firstDisplaySpreadPageNumber = Number(firstSpreadInput.value);
    spreadManager.firstSpreadNumber = preferences.firstDisplaySpreadPageNumber;
    spreadManager.updateSequence();
});
layoutSelect.addEventListener('change', () => {
    preferences.layout = Number(layoutSelect.value);
    spreadManager.maxPages = preferences.layout;
    spreadManager.updateSequence();
});

// --- Menu Event Handlers ---
ipcRenderer.on('apply-format', (event, formatType) => {
    const selection = quill.getSelection();
    if (selection) quill.format('pb-format', formatType);
});
ipcRenderer.on('add-spread', () => {
    spreadManager.addSpread();
});
ipcRenderer.on('delete-spread', () => {
    spreadManager.deleteSpread();
});

// --- Preferences from main ---
ipcRenderer.on('preferences-loaded', (event, prefs) => {
    preferences = prefs;
    if (prefs.layout) {
        layoutSelect.value = prefs.layout;
        spreadManager.maxPages = prefs.layout;
    }
    if (prefs.firstDisplaySpreadPageNumber) {
        firstSpreadInput.value = prefs.firstDisplaySpreadPageNumber;
        spreadManager.firstSpreadNumber = prefs.firstDisplaySpreadPageNumber;
    }
    spreadManager.updateSequence();
    // Apply layout class
    const editorContainer = document.querySelector('.ql-container');
    editorContainer.className = `ql-container layout-${preferences.layout}`;
});

// --- Enhanced Word Counter ---
function updateWordCount() {
    const delta = quill.getContents();
    let totalWords = 0;
    delta.ops.forEach(op => {
        if (op.insert && typeof op.insert === 'string') {
            const words = op.insert.trim().split(/\s+/).filter(w => w.length > 0);
            totalWords += words.length;
        }
    });
    document.getElementById('counter').textContent = `Words: ${totalWords}`;
}
quill.on('text-change', updateWordCount);
updateWordCount();

// --- Save/Load logic (JSON with metadata) ---
async function saveFile(filePath) {
    const content = quill.root.innerHTML;
    const metadata = {
        firstSpreadNumber: spreadManager.firstSpreadNumber,
        layout: spreadManager.maxPages,
        version: '2.0'
    };
    const documentData = {
        content: content,
        metadata: metadata
    };
    const result = await ipcRenderer.invoke('save-file', {
        filePath,
        content: JSON.stringify(documentData, null, 2)
    });
    if (result.success) {
        console.log('File saved successfully');
    } else {
        alert('Error saving file: ' + result.error);
    }
}
async function saveFileAs() {
    const filePath = await ipcRenderer.invoke('save-dialog');
    if (filePath) {
        await saveFile(filePath);
    }
}

// --- Keyboard Shortcuts for Spread Labels ---
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        if (e.shiftKey) {
            spreadManager.deleteSpread();
        } else {
            spreadManager.addSpread();
        }
        e.preventDefault();
    }
});

// --- Save Button Logic ---
const saveButton = document.getElementById('saveButton');
let currentFilePath = null;
let currentLayout = 32; // Default layout

// Handle menu events
ipcRenderer.on('new-file', () => {
    quill.setContents([]);
    currentFilePath = null;
});

ipcRenderer.on('file-opened', (event, { content, filePath }) => {
    quill.root.innerHTML = content;
    currentFilePath = filePath;
});

ipcRenderer.on('save-file', async () => {
    if (currentFilePath) {
        await saveFile(currentFilePath);
    } else {
        await saveFileAs();
    }
});

ipcRenderer.on('save-file-as', async () => {
    await saveFileAs();
});

ipcRenderer.on('undo', () => {
    quill.history.undo();
});

ipcRenderer.on('redo', () => {
    quill.history.redo();
});

ipcRenderer.on('cut', () => {
    document.execCommand('cut');
});

ipcRenderer.on('copy', () => {
    document.execCommand('copy');
});

ipcRenderer.on('paste', () => {
    document.execCommand('paste');
});

ipcRenderer.on('layout-changed', (event, pageCount) => {
    currentLayout = pageCount;
    // Update the editor container class
    const editorContainer = document.querySelector('.ql-container');
    editorContainer.className = `ql-container layout-${pageCount}`;
});

ipcRenderer.on('zoom-in', () => {
    const currentZoom = document.body.style.zoom || 1;
    document.body.style.zoom = currentZoom + 0.1;
});

ipcRenderer.on('zoom-out', () => {
    const currentZoom = document.body.style.zoom || 1;
    document.body.style.zoom = Math.max(0.5, currentZoom - 0.1);
});

ipcRenderer.on('zoom-reset', () => {
    document.body.style.zoom = 1;
});

// Button click handler
saveButton.addEventListener('click', async () => {
    if (currentFilePath) {
        await saveFile(currentFilePath);
    } else {
        await saveFileAs();
    }
});

// Helper: Generate spread label text given a start number and spread size
function getSpreadLabel(start, spreadSize = 2) {
  return `${start}-${start + spreadSize - 1}`;
}

// Helper: Find all spread labels and their positions
function getSpreadLabels() {
  const contents = quill.getContents();
  let labels = [];
  let index = 0;
  contents.ops.forEach(op => {
    if (op.insert && op.insert.spread) {
      labels.push({ index, value: op.insert.spread });
      index += 1; // custom blot counts as 1
    } else if (typeof op.insert === 'string') {
      index += op.insert.length;
    }
  });
  return labels;
}

// Helper: Renumber all spread labels in order, starting from a given number
function renumberSpreadLabels(startNumber = 2, spreadSize = 2) {
  const contents = quill.getContents();
  let labels = [];
  let index = 0;
  contents.ops.forEach(op => {
    if (op.insert && op.insert.spread) {
      labels.push({ index, value: op.insert.spread });
      index += 1;
    } else if (typeof op.insert === 'string') {
      index += op.insert.length;
    }
  });

  let current = startNumber;
  labels.forEach(label => {
    const newLabel = `${current}-${current + spreadSize - 1}`;
    if (label.value !== newLabel) {
      quill.deleteText(label.index, 1, 'silent');
      quill.insertEmbed(label.index, 'spread', newLabel, 'silent');
    }
    current += spreadSize;
  });
}

// Listen for text changes and renumber if a spread label was deleted
quill.on('text-change', (delta, oldDelta, source) => {
  // Check if any spread label was deleted
  let spreadDeleted = false;
  delta.ops.forEach(op => {
    if (op.delete) {
      // After a delete, renumber all spread labels
      spreadDeleted = true;
    }
  });
  if (spreadDeleted) {
    // Adjust these numbers as needed for your book layout
    renumberSpreadLabels(2, 2);
  }
});