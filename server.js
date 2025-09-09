const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();

// --- CONFIGURAÇÃO ESSENCIAL ---
const PORT = process.env.PORT || 8080; // Usa a porta do Render ou 8080 como padrão
const ALLOWED_ORIGIN = 'https://antonio438.github.io'; // URL do seu site front-end

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

// --- MIDDLEWARES ---
// Configuração de segurança CORS para permitir acesso apenas do seu site
app.use(cors({
    origin: ALLOWED_ORIGIN
}));
app.use(express.json());
// Servir arquivos estáticos da pasta uploads
app.use('/uploads', express.static(UPLOADS_DIR));


// --- FUNÇÕES AUXILIARES ---
const readData = (filePath) => {
    try {
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf-8');
            // Garante que o arquivo não está vazio antes de parsear
            return data ? JSON.parse(data) : [];
        }
        return [];
    } catch (error) {
        console.error(`Erro ao ler o arquivo ${filePath}:`, error);
        return []; // Retorna um array vazio em caso de erro
    }
};

const writeData = (filePath, data) => {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error(`Erro ao escrever no arquivo ${filePath}:`, error);
    }
};

// --- ROTAS DA API ---

// Rota para o PLANO DE CONTRATAÇÃO
app.get('/api/plan', (req, res) => {
    const planItems = readData(PLAN_DB_PATH);
    // Garante que sempre retorne um array
    res.json(Array.isArray(planItems) ? planItems : []);
});

// Rota para obter todos os PROCESSOS
app.get('/api/processes', (req, res) => {
    const processes = readData(PROCESSES_DB_PATH);
    // Garante que sempre retorne um array
    res.json(Array.isArray(processes) ? processes : []);
});

// Rota para ADICIONAR um novo processo
app.post('/api/processes', upload.array('files'), (req, res) => {
    const processes = readData(PROCESSES_DB_PATH);
    const newProcess = req.body;
    const now = new Date();

    newProcess.id = Date.now();
    newProcess.value = parseFloat(newProcess.value || 0);
    newProcess.purchasedValue = parseFloat(newProcess.purchasedValue || 0);

    // Converte 'location' de string JSON para objeto, se necessário
    if (typeof newProcess.location === 'string') {
        newProcess.location = JSON.parse(newProcess.location);
    }

    // Processa os anexos
    newProcess.attachments = req.files ? req.files.map(file => ({
        filename: file.filename,
        originalname: file.originalname,
        path: file.path
    })) : [];

    newProcess.creationDate = now.toISOString();
    // Inicializa o histórico de fase
    newProcess.history = [{
        fase: newProcess.fase,
        startDate: now.toISOString(),
        endDate: null
    }];
    // Inicializa o histórico de localização
    newProcess.locationHistory = [{
        sector: newProcess.location.sector,
        responsible: newProcess.location.responsible,
        startDate: now.toISOString(),
        endDate: null
    }];

    processes.push(newProcess);
    writeData(PROCESSES_DB_PATH, processes);
    res.status(201).json(newProcess);
});

// Rota para ATUALIZAR um processo existente
app.put('/api/processes/:id', upload.array('files'), (req, res) => {
    const processId = parseInt(req.params.id);
    const updatedData = req.body;
    const processes = readData(PROCESSES_DB_PATH);

    const processIndex = processes.findIndex(p => p.id === processId);
    if (processIndex === -1) {
        return res.status(404).json({ message: 'Processo não encontrado.' });
    }

    const existingProcess = { ...processes[processIndex] };
    const now = new Date().toISOString();

    // Garante que os históricos existam
    if (!existingProcess.history) existingProcess.history = [];
    if (!existingProcess.locationHistory) existingProcess.locationHistory = [];
    
    // Converte valores numéricos
    if (updatedData.value) updatedData.value = parseFloat(updatedData.value);
    if (updatedData.purchasedValue) updatedData.purchasedValue = parseFloat(updatedData.purchasedValue);

    // Lógica para rastrear a mudança de fase (se a opção de log estiver ativa)
    const logHistory = (updatedData.logHistory === 'true' || updatedData.logHistory === true);
    if (logHistory && updatedData.fase && updatedData.fase !== existingProcess.fase) {
        const lastHistoryEntry = existingProcess.history[existingProcess.history.length - 1];
        if (lastHistoryEntry) lastHistoryEntry.endDate = now;
        existingProcess.history.push({ fase: updatedData.fase, startDate: now, endDate: null });
    }

    // Converte 'location' de string para objeto, se necessário
    if (typeof updatedData.location === 'string') {
        updatedData.location = JSON.parse(updatedData.location);
    }

    // Lógica para rastrear a mudança de localização (se a opção de log estiver ativa)
    const newLocation = updatedData.location;
    const lastLocationEntry = existingProcess.locationHistory[existingProcess.locationHistory.length - 1];
    if (logHistory && newLocation && (newLocation.sector !== lastLocationEntry.sector || newLocation.responsible !== lastLocationEntry.responsible)) {
        if (lastLocationEntry) lastLocationEntry.endDate = now;
        existingProcess.locationHistory.push({
            sector: newLocation.sector,
            responsible: newLocation.responsible,
            startDate: now,
            endDate: null
        });
    }

    // Adiciona novos anexos sem apagar os antigos
    const existingAttachments = existingProcess.attachments || [];
    const newAttachments = req.files ? req.files.map(file => ({
        filename: file.filename,
        originalname: file.originalname,
        path: file.path
    })) : [];

    // Mescla os dados, garantindo que o ID não seja sobrescrito por engano
    processes[processIndex] = {
        ...existingProcess,
        ...updatedData,
        id: processId,
        attachments: [...existingAttachments, ...newAttachments]
    };

    writeData(PROCESSES_DB_PATH, processes);
    res.json(processes[processIndex]);
});

// Rota para EXCLUIR um processo
app.delete('/api/processes/:id', (req, res) => {
    const processId = parseInt(req.params.id);
    let processes = readData(PROCESSES_DB_PATH);
    
    const processToDelete = processes.find(p => p.id === processId);
    
    // Apaga os ficheiros de anexo associados ao processo
    if (processToDelete && processToDelete.attachments) {
        processToDelete.attachments.forEach(file => {
            if (fs.existsSync(file.path)) {
                fs.unlinkSync(file.path);
            }
        });
    }

    const updatedProcesses = processes.filter(p => p.id !== processId);

    if (processes.length === updatedProcesses.length) {
        return res.status(404).json({ message: 'Processo não encontrado.' });
    }

    writeData(PROCESSES_DB_PATH, updatedProcesses);
    res.status(204).send();
});

// --- INICIAR O SERVIDOR ---
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor a correr na porta ${PORT}`);
});
