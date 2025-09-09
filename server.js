const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = 3000;

const PLAN_DB_PATH = path.join(__dirname, 'plano.json');
const PROCESSES_DB_PATH = path.join(__dirname, 'processos.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Garante que o diretório de uploads exista
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR);
}

// Configuração do Multer para armazenamento de arquivos
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOADS_DIR);
    },
    filename: (req, file, cb) => {
        // Garante um nome de arquivo único para evitar sobreposições
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});

const upload = multer({ storage });


// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
// Servir arquivos estáticos da pasta uploads
app.use('/uploads', express.static(UPLOADS_DIR));


// --- Funções Auxiliares Genéricas ---
const readData = (filePath) => {
    try {
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf-8');
            return JSON.parse(data);
        }
        return {}; 
    } catch (error) {
        console.error(`Erro ao ler o arquivo ${filePath}:`, error);
        return {};
    }
};

const writeData = (filePath, data) => {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error(`Erro ao escrever no arquivo ${filePath}:`, error);
    }
};

// --- Rotas da API para o PLANO DE CONTRATAÇÃO ---

app.get('/api/plan', (req, res) => {
    const data = readData(PLAN_DB_PATH);
    res.json(data.processes || []);
});

// --- Rotas da API para os PROCESSOS OPERACIONAIS (CRUD completo) ---

app.get('/api/processes', (req, res) => {
    const data = readData(PROCESSES_DB_PATH);
    res.json(data.processes || []);
});

// POST: Adicionar um novo processo com arquivos
app.post('/api/processes', upload.array('files'), (req, res) => {
    const data = readData(PROCESSES_DB_PATH);
    if (!data.processes) data.processes = [];
    
    const newProcess = req.body;
    const now = new Date().toISOString();

    newProcess.id = Date.now();
    newProcess.value = parseFloat(newProcess.value);
    
    if (typeof newProcess.location === 'string') {
        newProcess.location = JSON.parse(newProcess.location);
    }

    if (req.files) {
        newProcess.attachments = req.files.map(file => ({
            filename: file.filename,
            originalname: file.originalname,
            path: file.path
        }));
    } else {
        newProcess.attachments = [];
    }
    
    newProcess.creationDate = now;
    // Inicializa o histórico de fase
    newProcess.history = [{
        fase: newProcess.fase,
        startDate: now,
        endDate: null
    }];
    // Inicializa o histórico de localização
    newProcess.locationHistory = [{
        sector: newProcess.location.sector,
        responsible: newProcess.location.responsible,
        startDate: now,
        endDate: null
    }];

    data.processes.push(newProcess);
    writeData(PROCESSES_DB_PATH, data);
    res.status(201).json(newProcess);
});


// PUT: Atualizar um processo existente com arquivos
app.put('/api/processes/:id', upload.array('files'), (req, res) => {
    const processId = parseInt(req.params.id);
    const updatedData = req.body;
    const data = readData(PROCESSES_DB_PATH);

    if (!data.processes) {
        return res.status(404).json({ message: 'Nenhum processo encontrado.' });
    }

    const processIndex = data.processes.findIndex(p => p.id === processId);

    if (processIndex === -1) {
        return res.status(404).json({ message: 'Processo não encontrado.' });
    }

    const existingProcess = { ...data.processes[processIndex] };
    const now = new Date().toISOString();

    // Lógica para rastrear a mudança de fase
    if (updatedData.fase && updatedData.fase !== existingProcess.fase) {
        if (!existingProcess.history) existingProcess.history = [];
        const lastHistoryEntry = existingProcess.history[existingProcess.history.length - 1];
        if (lastHistoryEntry) lastHistoryEntry.endDate = now;
        existingProcess.history.push({ fase: updatedData.fase, startDate: now, endDate: null });
    }
    
    // Converte location de string para objeto, se necessário
    if (typeof updatedData.location === 'string') {
        updatedData.location = JSON.parse(updatedData.location);
    }

    // Lógica para rastrear a mudança de localização
    const newLocation = updatedData.location;
    if (newLocation && (newLocation.sector !== existingProcess.location.sector || newLocation.responsible !== existingProcess.location.responsible)) {
        if (!existingProcess.locationHistory) existingProcess.locationHistory = [];
        
        // CORREÇÃO DO BUG: Usar o 'locationHistory' para encontrar o último item, e não o 'history'.
        const lastLocationEntry = existingProcess.locationHistory[existingProcess.locationHistory.length - 1];
        if (lastLocationEntry) {
            lastLocationEntry.endDate = now;
        }

        existingProcess.locationHistory.push({
            sector: newLocation.sector,
            responsible: newLocation.responsible,
            startDate: now,
            endDate: null
        });
    }

    const existingAttachments = existingProcess.attachments || [];
    const newAttachments = req.files ? req.files.map(file => ({
        filename: file.filename,
        originalname: file.originalname,
        path: file.path
    })) : [];
    
    if (updatedData.value) updatedData.value = parseFloat(updatedData.value);

    data.processes[processIndex] = { 
        ...existingProcess,
        ...updatedData, 
        id: processId,
        attachments: [...existingAttachments, ...newAttachments]
    };
    
    writeData(PROCESSES_DB_PATH, data);
    res.json(data.processes[processIndex]);
});


// DELETE: Excluir um processo
app.delete('/api/processes/:id', (req, res) => {
    const processId = parseInt(req.params.id);
    const data = readData(PROCESSES_DB_PATH);

    if (!data.processes) {
        return res.status(404).json({ message: 'Nenhum processo encontrado.' });
    }

    const processToDelete = data.processes.find(p => p.id === processId);
    
    if (processToDelete && processToDelete.attachments) {
        processToDelete.attachments.forEach(file => {
            if (fs.existsSync(file.path)) {
                fs.unlinkSync(file.path);
            }
        });
    }

    const initialLength = data.processes.length;
    data.processes = data.processes.filter(p => p.id !== processId);

    if (data.processes.length === initialLength) {
        return res.status(404).json({ message: 'Processo não encontrado.' });
    }

    writeData(PROCESSES_DB_PATH, data);
    res.status(204).send();
});


// Iniciar o servidor
app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});