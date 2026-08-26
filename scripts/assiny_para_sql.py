#!/usr/bin/env python3
"""Converte um report-transaction da Assiny em SQL de carga para qualificador.staging_assiny.

Uso: assiny_para_sql.py <arquivo.csv> <dir_saida> [linhas_por_lote]
Gera <dir_saida>/NNN.sql. O primeiro lote cria a importacao com um id fixo,
impresso em stdout junto com a contagem de linhas do arquivo.
"""
import csv, sys, os, uuid

# CSV da Assiny -> coluna do staging
MAPA = [
    ("TransactionId","transaction_id"), ("NomeDoProduto","nome_do_produto"),
    ("TipoDeCheckout","tipo_de_checkout"), ("NomeDoProjeto","nome_do_projeto"),
    ("ProjectId","project_id"), ("NomeDaOrganizacao","nome_da_organizacao"),
    ("OrganizationId","organization_id"), ("Valor","valor"), ("Taxa","taxa"),
    ("ValorLiquido","valor_liquido"), ("Parcelas","parcelas"), ("Moeda","moeda"),
    ("CriadoEm","criado_em"), ("AtualizadoEm","atualizado_em"), ("Status","status"),
    ("TipoDePagamento","tipo_de_pagamento"), ("OfferId","offer_id"),
    ("NomeDaOferta","nome_da_oferta"), ("NomeDoFunil","nome_do_funil"),
    ("ClientId","client_id"), ("NomeCompletoDoCliente","nome_completo_do_cliente"),
    ("TelefoneDoCliente","telefone_do_cliente"), ("EmailDoCliente","email_do_cliente"),
    ("DocumentoDoCliente","documento_do_cliente"),
    ("TipoDocumentoDoCliente","tipo_documento_do_cliente"),
    ("UtmCampaign","utm_campaign"), ("UtmContent","utm_content"),
    ("UtmMedium","utm_medium"), ("UtmSource","utm_source"), ("UtmTerm","utm_term"),
    ("ShortFunnelId","short_funnel_id"), ("NodeId","node_id"), ("FunnelId","funnel_id"),
]
COLS = ["importacao_id","linha"] + [d for _, d in MAPA]

def lit(v):
    if v is None or v == "":
        return "null"
    return "'" + v.replace("'", "''") + "'"

ESSENCIAIS = {"TransactionId","TipoDeCheckout","NomeDoProduto","NomeDoProjeto","ProjectId",
    "Valor","ValorLiquido","CriadoEm","Status","NomeDaOferta","NomeDoFunil","ClientId",
    "NomeCompletoDoCliente","TelefoneDoCliente","EmailDoCliente","DocumentoDoCliente","UtmSource"}

def main():
    global MAPA, COLS
    caminho, saida = sys.argv[1], sys.argv[2]
    if "--essenciais" in sys.argv:
        MAPA = [(o, d) for o, d in MAPA if o in ESSENCIAIS]
        COLS = ["importacao_id", "linha"] + [d for _, d in MAPA]
    lote = int(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3].isdigit() else 400
    imp_id = str(uuid.uuid4())
    arquivo = os.path.basename(caminho)
    os.makedirs(saida, exist_ok=True)

    with open(caminho, encoding="utf-8-sig", newline="") as fh:
        linhas = list(csv.DictReader(fh))

    n = 0
    with open(os.path.join(saida, "000.sql"), "w", encoding="utf-8") as f:
        f.write("insert into qualificador.importacao (id, arquivo) values "
                f"({lit(imp_id)}, {lit(arquivo)});\n")

    for i in range(0, len(linhas), lote):
        n += 1
        bloco = linhas[i:i + lote]
        with open(os.path.join(saida, f"{n:03d}.sql"), "w", encoding="utf-8") as f:
            f.write(f"insert into qualificador.staging_assiny ({','.join(COLS)}) values\n")
            f.write(",\n".join(
                "(" + ",".join([lit(imp_id), str(i + j + 1)]
                               + [lit(r.get(o)) for o, _ in MAPA]) + ")"
                for j, r in enumerate(bloco)))
            f.write(";\n")

    print(f"importacao_id={imp_id}")
    print(f"arquivo={arquivo}")
    print(f"linhas_csv={len(linhas)}")
    print(f"lotes={n}")

if __name__ == "__main__":
    main()
