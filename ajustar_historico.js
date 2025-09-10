const fs = require('fs');
const path = require('path');

// Define o caminho para o seu arquivo de banco de dados de processos
const PROCESSES_DB_PATH = path.join(__dirname, 'processos.json');

/**
 * Script para corrigir a data de início (startDate) no histórico de processos
 * que já estão com a fase "Contratado".
 * Ele garante que a data no histórico seja a mesma da 'contractDate' principal do processo.
 */
function ajustarDatasDeContratacao() {
    console.log("Iniciando o script de ajuste de datas de histórico...");

    // 1. Ler o arquivo de processos
    let data;
    try {
        const fileContent = fs.readFileSync(PROCESSES_DB_PATH, 'utf-8');
        data = JSON.parse(fileContent);
        console.log("Arquivo 'processos.json' lido com sucesso.");
    } catch (error) {
        console.error("Erro ao ler ou analisar o arquivo 'processos.json':", error);
        return; // Encerra o script se não conseguir ler o arquivo
    }

    if (!data.processes || data.processes.length === 0) {
        console.log("Nenhum processo encontrado no arquivo. Encerrando script.");
        return;
    }

    let processosAjustados = 0;

    // 2. Percorrer cada processo
    data.processes.forEach(processo => {
        // 3. Verificar as condições para ajuste
        if (
            processo.fase === 'Contratado' &&      // A fase atual é "Contratado"
            processo.contractDate &&               // Existe uma data de contratação
            processo.history &&                    // Existe um array de histórico
            processo.history.length > 0            // O histórico não está vazio
        ) {
            // Pega o último registro do histórico, que deve ser o de "Contratado"
            const ultimoHistorico = processo.history[processo.history.length - 1];

            // Converte a data de contratação para o formato ISO (o mesmo usado no histórico)
            // Usamos 'T12:00:00Z' para evitar problemas de fuso horário que possam alterar o dia
            const dataContratacaoISO = new Date(processo.contractDate + 'T12:00:00Z').toISOString();

            // 4. Se a data do histórico for diferente, atualiza
            if (ultimoHistorico.fase === 'Contratado' && ultimoHistorico.startDate !== dataContratacaoISO) {
                console.log(`- Ajustando processo Nº ${processo.processNumber || processo.id}:`);
                console.log(`  Data antiga no histórico: ${ultimoHistorico.startDate}`);
                ultimoHistorico.startDate = dataContratacaoISO;
                console.log(`  Nova data no histórico:   ${ultimoHistorico.startDate}`);
                processosAjustados++;
            }
        }
    });

    if (processosAjustados > 0) {
        // 5. Salvar o arquivo com as correções
        try {
            fs.writeFileSync(PROCESSES_DB_PATH, JSON.stringify(data, null, 2));
            console.log(`\nSucesso! ${processosAjustados} processo(s) foram ajustados.`);
            console.log("O arquivo 'processos.json' foi atualizado com as datas corretas.");
        } catch (error) {
            console.error("Erro ao salvar as alterações no arquivo 'processos.json':", error);
        }
    } else {
        console.log("\nNenhum processo precisou de ajuste. As datas já estavam corretas.");
    }
}

// Executa a função
ajustarDatasDeContratacao();