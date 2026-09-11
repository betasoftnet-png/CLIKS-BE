const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');

// In-memory persistent cache / fallback if table is newly seeded
let memoryEngagements = [
    {
        id: 1,
        clientName: 'Metro Auto Spares Pvt Ltd',
        trade: 'Automotive Components Mfg',
        pan: 'AAACM1234F',
        gstin: '27AAACM1234F1Z5',
        entityType: 'Private Limited',
        auditType: 'Statutory Audit',
        financialYear: '2025-2026',
        agreedFee: 150000,
        leadPartner: 'CA Rajesh Sharma',
        status: 'In Fieldwork',
        scopeOfWork: ['Statutory Audit Sec 139', 'Tax Audit Sec 44AB', 'CARO 2020 Reporting']
    },
    {
        id: 2,
        clientName: 'Apex Logistics & Freight LLP',
        trade: 'Cold-chain Freight & Logistics',
        pan: 'AALFA5678G',
        gstin: '29AALFA5678G1Z2',
        entityType: 'Partnership',
        auditType: 'Tax Audit',
        financialYear: '2025-2026',
        agreedFee: 85000,
        leadPartner: 'CA Suresh Iyer',
        status: 'Drafting',
        scopeOfWork: ['Tax Audit Sec 44AB', 'GSTR-9C Annual Audit']
    },
    {
        id: 3,
        clientName: 'Zenith Life Sciences Ltd',
        trade: 'Pharmaceutical Formulations',
        pan: 'AAACZ9876H',
        gstin: '24AAACZ9876H1Z8',
        entityType: 'Private Limited',
        auditType: 'Statutory Audit',
        financialYear: '2025-2026',
        agreedFee: 320000,
        leadPartner: 'CA Rajesh Sharma',
        status: 'Signed & Concluded',
        scopeOfWork: ['Statutory Audit Sec 139', 'Transfer Pricing 3CEB', 'CARO 2020 Reporting']
    },
    {
        id: 4,
        clientName: 'Kavita Organic Retail',
        trade: 'Organic Grocery Superstores',
        pan: 'BHPK3456D',
        gstin: '33BHPK3456D1Z1',
        entityType: 'Sole Proprietor',
        auditType: 'Tax Audit',
        financialYear: '2024-2025',
        agreedFee: 45000,
        leadPartner: 'CA Meera Nair',
        status: 'In Fieldwork',
        scopeOfWork: ['Tax Audit Sec 44AB']
    },
    {
        id: 5,
        clientName: 'Trident Precision Fasteners',
        trade: 'Industrial Hardware Export',
        pan: 'AAACT8811K',
        gstin: '07AAACT8811K1Z9',
        entityType: 'Private Limited',
        auditType: 'Internal Audit',
        financialYear: '2025-2026',
        agreedFee: 120000,
        leadPartner: 'CA Suresh Iyer',
        status: 'In Fieldwork',
        scopeOfWork: ['Internal Financial Controls IFC', 'Inventory Vouching']
    }
];

let memoryChecklists = [
    {
        id: 'tax_3cd_21d',
        framework: 'Tax Audit Form 3CD',
        clause: 'Clause 21(d) - Section 40A(3) Cash Payments',
        description: 'Disallowance of expenditure incurred for which payment is made in cash exceeding ₹10,000 in a day to an individual otherwise than by crossed cheque/draft/ECS.',
        status: 'Compliant',
        observation: 'Sample of 45 vouchers verified across 4 branch daybooks. All cash payments kept strictly below statutory ₹10,000 threshold.',
        attachments: ['cash_voucher_sampling_report.pdf']
    },
    {
        id: 'tax_3cd_34a',
        framework: 'Tax Audit Form 3CD',
        clause: 'Clause 34(a) - Chapter XVII-B TDS/TCS Compliance',
        description: 'Whether the assessee was required to deduct or collect tax as per the provisions of Chapter XVII-B and whether tax was deducted/collected and paid on time.',
        status: 'Non-Compliant',
        observation: 'Delay of 14 days identified in remittance of Sec 194C contract TDS for July 2025. Interest liability of ₹1,840 quantified and acknowledged.',
        attachments: ['tds_26q_reconciliation.xlsx']
    },
    {
        id: 'tax_3cd_17',
        framework: 'Tax Audit Form 3CD',
        clause: 'Clause 17 - Depreciation Admissible Under Section 32',
        description: 'Particulars of depreciation admissible as per Income Tax Act, including classification of assets, block of assets, and additions/deductions with actual dates of use.',
        status: 'Compliant',
        observation: 'Plant & Machinery additions put to use for more than 180 days verified via installation certificates. 100% depreciation rate correctly claimed.',
        attachments: ['fixed_assets_schedule_it_act.pdf']
    },
    {
        id: 'tax_3cd_26',
        framework: 'Tax Audit Form 3CD',
        clause: 'Clause 26 - Liability Covered by Section 43B',
        description: 'Verification of bonus, commission, gratuity, statutory duties, and taxes deductible only on actual payment before due date of filing return under Section 139(1).',
        status: 'Compliant',
        observation: 'Staff statutory bonus of ₹4.85 Lakhs paid on 12-Aug-2025 prior to the 44AB filing deadline. Bank challans reconciled with general ledger.',
        attachments: ['sec_43b_bonus_challans.pdf']
    },
    {
        id: 'caro_3_ii',
        framework: 'CARO 2020',
        clause: 'Clause 3(ii) - Physical Verification of Inventory',
        description: 'Whether physical verification of inventory has been conducted at reasonable intervals by the management and whether any discrepancies of 10% or more were noticed.',
        status: 'Compliant',
        observation: 'Bi-annual inventory stock count attended by engagement article assistant at Central Godown. Discrepancy observed was 0.4% (well within normal scrap tolerance).',
        attachments: ['stock_count_certificate.pdf']
    },
    {
        id: 'caro_3_vii',
        framework: 'CARO 2020',
        clause: 'Clause 3(vii) - Statutory Dues Regularity',
        description: 'Whether the company is regular in depositing undisputed statutory dues including Provident Fund, ESI, Income-tax, Sales-tax, GST, Customs Duty, Cess.',
        status: 'Compliant',
        observation: 'All monthly GST returns (GSTR-3B) and PF/ESI electronic challan returns deposited on or before the 20th of succeeding month.',
        attachments: ['statutory_dues_ledger_audit.pdf']
    },
    {
        id: 'sec138_ifc',
        framework: 'Section 138',
        clause: 'Section 138 - Internal Financial Controls Evaluation',
        description: 'Review of the adequacy and operating effectiveness of internal financial controls with reference to financial reporting and asset safeguard protocols.',
        status: 'Compliant',
        observation: 'Dual-authorization protocols in banking portal functioning satisfactorily. Purchase order approval hierarchy enforced.',
        attachments: ['ifc_control_matrix_2026.pdf']
    }
];

let memoryTasks = [
    {
        id: 1,
        title: 'Stock Reconciliation at Central Warehouse',
        client: 'Metro Auto Spares Pvt Ltd',
        assignee: 'Suresh (Article Year 2)',
        priority: 'High',
        dueDate: '2026-09-24',
        stage: 'In Fieldwork'
    },
    {
        id: 2,
        title: 'TDS Returns Reconciliation 26AS vs Books',
        client: 'Apex Logistics & Freight LLP',
        assignee: 'Pooja (Senior Auditor)',
        priority: 'Urgent',
        dueDate: '2026-09-18',
        stage: 'In Fieldwork'
    },
    {
        id: 3,
        title: 'Fixed Assets Register Physical Inspection',
        client: 'Zenith Life Sciences Ltd',
        assignee: 'Ankit (Audit Manager)',
        priority: 'Medium',
        dueDate: '2026-10-05',
        stage: 'Unassigned'
    },
    {
        id: 4,
        title: 'Section 43B Dues Clearance Verification',
        client: 'Trident Precision Fasteners',
        assignee: 'Suresh (Article Year 2)',
        priority: 'High',
        dueDate: '2026-09-28',
        stage: 'Under Review'
    },
    {
        id: 5,
        title: 'Draft Audit Report & CARO Notes Formulation',
        client: 'Metro Auto Spares Pvt Ltd',
        assignee: 'Ankit (Audit Manager)',
        priority: 'Urgent',
        dueDate: '2026-09-20',
        stage: 'Under Review'
    },
    {
        id: 6,
        title: 'Final Partner Sign-off & UDIN Generation',
        client: 'Zenith Life Sciences Ltd',
        assignee: 'CA Rajesh Sharma',
        priority: 'High',
        dueDate: '2026-09-15',
        stage: 'Approved'
    }
];

// ── GET /analytics/overview ──────────────────────────────────────────────────
exports.getAnalyticsOverview = async (req, res) => {
    try {
        const data = {
            kpis: {
                activeEngagements: memoryEngagements.filter(e => e.status !== 'Signed & Concluded').length + 9,
                pendingSignOffs: 5,
                overdueDeadlines: 2,
                unbilledHours: 142.5
            },
            statutoryDeadlines: [
                {
                    id: 1,
                    clientName: 'Metro Auto Spares Pvt Ltd',
                    filingType: 'Tax Audit (Sec 44AB)',
                    targetDate: '2026-09-30',
                    status: 'High Risk',
                    statusType: 'danger'
                },
                {
                    id: 2,
                    clientName: 'Apex Logistics & Freight LLP',
                    filingType: 'CARO 2020 Compliance',
                    targetDate: '2026-10-15',
                    status: 'Pending Review',
                    statusType: 'warning'
                },
                {
                    id: 3,
                    clientName: 'Zenith Life Sciences Ltd',
                    filingType: 'GSTR-9C Annual Audit',
                    targetDate: '2026-10-31',
                    status: 'In Progress',
                    statusType: 'info'
                },
                {
                    id: 4,
                    clientName: 'Trident Precision Fasteners',
                    filingType: 'Sec 138 Internal Controls',
                    targetDate: '2026-11-15',
                    status: 'On Track',
                    statusType: 'success'
                },
                {
                    id: 5,
                    clientName: 'Kaveri Granites & Minerals',
                    filingType: 'Transfer Pricing (3CEB)',
                    targetDate: '2026-10-31',
                    status: 'Critical Action',
                    statusType: 'danger'
                }
            ],
            statusDistribution: {
                fieldwork: 40,
                drafting: 30,
                partnerReview: 20,
                reportSigned: 10
            }
        };

        return sendSuccess(res, data, 'FIN-PRO practice analytics retrieved successfully');
    } catch (err) {
        console.error('getAnalyticsOverview error:', err);
        return sendError(res, 'Failed to fetch analytics overview', 500);
    }
};

// ── GET /engagements ─────────────────────────────────────────────────────────
exports.getEngagements = async (req, res) => {
    try {
        const { search, entityType } = req.query;
        let results = [...memoryEngagements];

        if (search) {
            const s = String(search).toLowerCase();
            results = results.filter(e => 
                e.clientName.toLowerCase().includes(s) || 
                (e.trade && e.trade.toLowerCase().includes(s)) ||
                (e.leadPartner && e.leadPartner.toLowerCase().includes(s))
            );
        }

        if (entityType && entityType !== 'All') {
            results = results.filter(e => e.entityType === entityType);
        }

        return sendSuccess(res, results, 'Engagements retrieved successfully');
    } catch (err) {
        console.error('getEngagements error:', err);
        return sendError(res, 'Failed to fetch engagements', 500);
    }
};

// ── POST /engagements ────────────────────────────────────────────────────────
exports.createEngagement = async (req, res) => {
    try {
        const {
            clientName,
            trade,
            pan,
            gstin,
            entityType,
            auditType,
            financialYear,
            agreedFee,
            leadPartner,
            scopeOfWork
        } = req.body;

        if (!clientName) {
            return sendError(res, 'Client name is required', 400);
        }

        const newEngagement = {
            id: Date.now(),
            clientName: clientName.trim(),
            trade: trade || 'Corporate Trade',
            pan: pan ? pan.toUpperCase() : 'PANPENDING',
            gstin: gstin ? gstin.toUpperCase() : 'GSTINPENDING',
            entityType: entityType || 'Private Limited',
            auditType: auditType || 'Statutory Audit',
            financialYear: financialYear || '2025-2026',
            agreedFee: Number(agreedFee) || 50000,
            leadPartner: leadPartner || 'CA Rajesh Sharma',
            status: 'Drafting',
            scopeOfWork: Array.isArray(scopeOfWork) ? scopeOfWork : ['Statutory Compliance Audit']
        };

        memoryEngagements.unshift(newEngagement);
        return sendSuccess(res, newEngagement, 'New engagement initiated successfully', 201);
    } catch (err) {
        console.error('createEngagement error:', err);
        return sendError(res, 'Failed to create engagement', 500);
    }
};

// ── GET /checklists ──────────────────────────────────────────────────────────
exports.getChecklists = async (req, res) => {
    try {
        const { framework } = req.query;
        let results = [...memoryChecklists];

        if (framework && framework !== 'All') {
            results = results.filter(c => c.framework.toLowerCase().includes(framework.toLowerCase()));
        }

        return sendSuccess(res, results, 'Checklist matrix retrieved successfully');
    } catch (err) {
        console.error('getChecklists error:', err);
        return sendError(res, 'Failed to fetch checklists', 500);
    }
};

// ── PATCH /checklists/:clauseId ──────────────────────────────────────────────
exports.updateChecklistClause = async (req, res) => {
    try {
        const { clauseId } = req.params;
        const { status, observation, attachments } = req.body;

        const idx = memoryChecklists.findIndex(c => c.id === clauseId || String(c.id) === String(clauseId));
        if (idx === -1) {
            return sendError(res, 'Checklist clause not found', 404);
        }

        if (status !== undefined) memoryChecklists[idx].status = status;
        if (observation !== undefined) memoryChecklists[idx].observation = observation;
        if (attachments !== undefined) memoryChecklists[idx].attachments = attachments;

        return sendSuccess(res, memoryChecklists[idx], 'Clause compliance audit record updated');
    } catch (err) {
        console.error('updateChecklistClause error:', err);
        return sendError(res, 'Failed to update clause', 500);
    }
};

// ── GET /tasks ───────────────────────────────────────────────────────────────
exports.getTasks = async (req, res) => {
    try {
        return sendSuccess(res, memoryTasks, 'Team tasks retrieved successfully');
    } catch (err) {
        console.error('getTasks error:', err);
        return sendError(res, 'Failed to fetch tasks', 500);
    }
};

// ── PATCH /tasks/:taskId/stage ───────────────────────────────────────────────
exports.updateTaskStage = async (req, res) => {
    try {
        const { taskId } = req.params;
        const { stage } = req.body;

        const idx = memoryTasks.findIndex(t => String(t.id) === String(taskId));
        if (idx === -1) {
            return sendError(res, 'Task not found', 404);
        }

        if (stage) {
            memoryTasks[idx].stage = stage;
        } else {
            // Cycle forward through stages: Unassigned -> In Fieldwork -> Under Review -> Approved
            const stages = ['Unassigned', 'In Fieldwork', 'Under Review', 'Approved'];
            const curIdx = stages.indexOf(memoryTasks[idx].stage);
            const nextIdx = curIdx < stages.length - 1 ? curIdx + 1 : curIdx;
            memoryTasks[idx].stage = stages[nextIdx];
        }

        return sendSuccess(res, memoryTasks[idx], 'Task stage updated successfully');
    } catch (err) {
        console.error('updateTaskStage error:', err);
        return sendError(res, 'Failed to update task stage', 500);
    }
};

// ── POST /tasks ──────────────────────────────────────────────────────────────
exports.createTask = async (req, res) => {
    try {
        const { title, client, assignee, priority, dueDate, stage } = req.body;
        if (!title) {
            return sendError(res, 'Task title is required', 400);
        }

        const newTask = {
            id: Date.now(),
            title: title.trim(),
            client: client || 'General Practice Client',
            assignee: assignee || 'Unassigned Staff',
            priority: priority || 'Medium',
            dueDate: dueDate || new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
            stage: stage || 'Unassigned'
        };

        memoryTasks.unshift(newTask);
        return sendSuccess(res, newTask, 'Task allocated to practice staff', 201);
    } catch (err) {
        console.error('createTask error:', err);
        return sendError(res, 'Failed to create task', 500);
    }
};
