import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, afterEach } from 'vitest';
import { defaultConfig } from '../src/config/defaultConfig.ts';
import { buildAgentPrompt, buildAiPromptInput } from '../src/ai/promptBuilder.ts';
import {
  beginRun,
  checkRun,
  completeRun,
  getNextUnstartedOpportunity,
  readRunBaseline,
} from '../src/core/runManager.ts';
import { scanRepository } from '../src/core/scanner.ts';
import {
  createOutputScanResult,
  createOutputScanResultForLatestTasks,
  writeScanOutputs,
  writeTasksFile,
} from '../src/output/promptWriter.ts';
import { getPackageVersion } from '../src/utils/packageInfo.ts';

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('release metadata', () => {
  it('reads the CLI version from package.json', () => {
    const packageJson = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
      version: string;
    };

    expect(getPackageVersion()).toBe(packageJson.version);
  });
});

describe('scanRepository', () => {
  it('finds refactor opportunities in a messy React file', async () => {
    const root = createTempProject();
    const sourceDirectory = path.join(root, 'src', 'components');
    mkdirSync(sourceDirectory, { recursive: true });
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ dependencies: { react: '^18.0.0' } }),
    );
    writeFileSync(
      path.join(sourceDirectory, 'Dashboard.tsx'),
      `
import React, { useEffect, useMemo, useState } from 'react';

export function Dashboard({ userId, token, region, currency, flags, onSelect }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [sort, setSort] = useState('name');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const response = await fetch('/api/dashboard?user=' + userId);
      const json = await response.json();
      setItems(json.items);
      setLoading(false);
    }
    load();
  }, [userId]);

  const visible = useMemo(() => {
    return items
      .filter((item) => filter === 'all' || item.status === filter)
      .filter((item) => item.name.includes(query))
      .sort((a, b) => a[sort] > b[sort] ? 1 : -1);
  }, [items, filter, query, sort]);

  function calculateStatus(item, permissions, now, fallback, options, audit) {
    if (!item) {
      return fallback;
    }
    if (item.disabled) {
      if (permissions.canRestore) {
        return 'restorable';
      }
      return 'disabled';
    }
    if (item.expiry) {
      if (item.expiry < now) {
        if (options.allowExpired) {
          return 'expired_allowed';
        }
        return 'expired';
      }
      if (item.expiry === now) {
        return 'expires_today';
      }
    }
    if (item.owner === userId) {
      if (audit.required) {
        return 'audit';
      }
      return 'owned';
    }
    return 'active';
  }

  // TODO: split this component
  return (
    <section style={{ padding: 20 }}>
      {loading && <p>Loading</p>}
      {error && <p>{error}</p>}
      {visible.map((item) => (
        <button key={item.id} onClick={() => onSelect(calculateStatus(item, {}, Date.now(), 'none', {}, {}))}>
          {item.name}
        </button>
      ))}
    </section>
  );
}
`,
    );

    const result = await scanRepository(root, {
      ...defaultConfig,
      include: ['src/**/*.{ts,tsx,js,jsx}'],
      thresholds: {
        ...defaultConfig.thresholds,
        largeComponentLines: 40,
        complexFunctionLines: 20,
      },
    });

    expect(result.files).toHaveLength(1);
    expect(
      result.opportunities.some((opportunity) => opportunity.type === 'extract-service-layer'),
    ).toBe(true);
    expect(result.opportunities.some((opportunity) => opportunity.type === 'extract-hook')).toBe(
      true,
    );
    expect(
      result.opportunities.some((opportunity) => opportunity.type === 'simplify-complex-function'),
    ).toBe(true);
    expect(result.summary.filesScanned).toBe(1);
  });

  it('writes report, prompt files, tasks, and scan JSON', async () => {
    const root = createTempProject();
    mkdirSync(path.join(root, 'src'), { recursive: true });
    writeFileSync(
      path.join(root, 'src', 'auth.ts'),
      `
export function validateAuth(token, user, permissions, flags, request, audit) {
  if (!token) return false;
  if (user.disabled) return false;
  if (permissions.admin) return true;
  if (flags.beta && request.path.includes('/beta')) return true;
  if (audit.required && !audit.completed) return false;
  return user.roles.includes('member');
}
`,
    );

    const result = await scanRepository(root, {
      ...defaultConfig,
      include: ['src/**/*.{ts,tsx,js,jsx}'],
      thresholds: {
        ...defaultConfig.thresholds,
        complexFunctionComplexity: 4,
      },
    });
    const output = writeScanOutputs(
      root,
      { ...defaultConfig, output: { ...defaultConfig.output, minPriority: 'low' } },
      result,
    );

    expect(output.reportPath).toBeDefined();
    expect(output.tasksPath).toBeDefined();
    expect(output.scanJsonPath).toBeDefined();
    expect(output.promptPaths.length).toBeGreaterThan(0);
  });

  it('limits human-facing scan output while keeping scan JSON complete', async () => {
    const root = createTempProject();
    const firstPath = writeMessyComponent(root);
    const secondDirectory = path.join(root, 'src', 'screens');
    mkdirSync(secondDirectory, { recursive: true });
    writeFileSync(path.join(secondDirectory, 'Settings.tsx'), readFileSync(firstPath, 'utf8'));

    const config = {
      ...defaultConfig,
      output: { ...defaultConfig.output, limit: 1, minPriority: 'low' as const },
      thresholds: {
        ...defaultConfig.thresholds,
        largeComponentLines: 40,
        complexFunctionLines: 20,
      },
    };
    const result = await scanRepository(root, config);
    const outputResult = createOutputScanResult(result, config);
    const output = writeScanOutputs(root, config, result);
    const scanJson = JSON.parse(readFileSync(output.scanJsonPath!, 'utf8'));
    const outputSettings = JSON.parse(
      readFileSync(path.join(output.outputDirectory, 'data', 'output-settings.json'), 'utf8'),
    );
    const taskList = readFileSync(output.tasksPath!, 'utf8');

    expect(result.opportunities.length).toBeGreaterThan(1);
    expect(outputResult.opportunities).toHaveLength(1);
    expect(output.promptPaths).toHaveLength(outputResult.opportunities.length);
    expect(outputResult.opportunities[0].aiPromptPath).toMatch(/^prompts\/01_/);
    expect(countTaskHeadings(taskList)).toBe(outputResult.opportunities.length);
    expect(taskList).toContain(`Prompt: \`${outputResult.opportunities[0].aiPromptPath}\``);
    expect(scanJson.opportunities).toHaveLength(result.opportunities.length);
    expect(outputSettings).toEqual({ limit: 1, minPriority: 'low' });

    const zeroLimitConfig = {
      ...config,
      output: { ...config.output, limit: 0 },
    };
    const zeroLimitOutput = writeScanOutputs(root, zeroLimitConfig, result);
    const zeroLimitScanJson = JSON.parse(readFileSync(zeroLimitOutput.scanJsonPath!, 'utf8'));
    const zeroLimitTaskList = readFileSync(zeroLimitOutput.tasksPath!, 'utf8');

    expect(zeroLimitOutput.promptPaths).toHaveLength(0);
    expect(countTaskHeadings(zeroLimitTaskList)).toBe(0);
    expect(zeroLimitScanJson.opportunities).toHaveLength(result.opportunities.length);
  });

  it('regenerates task output using the latest persisted output settings', async () => {
    const root = createTempProject();
    const firstPath = writeMessyComponent(root);
    const secondDirectory = path.join(root, 'src', 'screens');
    mkdirSync(secondDirectory, { recursive: true });
    writeFileSync(path.join(secondDirectory, 'Settings.tsx'), readFileSync(firstPath, 'utf8'));

    const scanConfig = {
      ...defaultConfig,
      output: { ...defaultConfig.output, limit: 1, minPriority: 'low' as const },
      thresholds: {
        ...defaultConfig.thresholds,
        largeComponentLines: 40,
        complexFunctionLines: 20,
      },
    };
    const currentConfig = {
      ...scanConfig,
      output: { ...defaultConfig.output, limit: 20, minPriority: 'medium' as const },
    };
    const result = await scanRepository(root, scanConfig);
    const output = writeScanOutputs(root, scanConfig, result);
    const scanJson = JSON.parse(readFileSync(output.scanJsonPath!, 'utf8'));
    const outputResult = createOutputScanResultForLatestTasks(
      output.outputDirectory,
      currentConfig,
      scanJson,
    );
    const tasksPath = writeTasksFile(output.outputDirectory, outputResult);
    const regeneratedTasks = readFileSync(tasksPath, 'utf8');

    expect(scanJson.opportunities.length).toBeGreaterThan(1);
    expect(outputResult.opportunities).toHaveLength(1);
    expect(countTaskHeadings(regeneratedTasks)).toBe(1);
    expect(regeneratedTasks).toContain(`Prompt: \`${outputResult.opportunities[0].aiPromptPath}\``);
  });

  it('scans Python files with alpha heuristic metrics and opportunities', async () => {
    const root = createTempProject();
    mkdirSync(path.join(root, 'src', 'billing'), { recursive: true });
    writeFileSync(
      path.join(root, 'src', 'billing', 'service.py'),
      `
import requests
from pydantic import BaseModel

class Invoice(BaseModel):
    amount: int

def calculate_invoice(user, invoice, permissions, flags, request, audit):
    if not user:
        return 0
    if permissions.get("admin"):
        return invoice.amount
    if flags.get("trial"):
        if request.get("region") == "ca":
            return invoice.amount - 10
        return invoice.amount - 5
    if audit.get("required"):
        if audit.get("passed"):
            return invoice.amount
        return 0
    response = requests.get("https://example.com")
    if response.status_code == 200:
        return invoice.amount
    return 0
`,
    );

    const result = await scanRepository(root, {
      ...defaultConfig,
      include: ['src/**/*.py'],
      thresholds: {
        ...defaultConfig.thresholds,
        complexFunctionComplexity: 4,
      },
    });

    const file = result.files[0];
    expect(file.language).toBe('python');
    expect(file.importCount).toBe(2);
    expect(file.functionCount).toBe(1);
    expect(file.responsibilities).toContain('data-fetching');
    expect(result.opportunities.some((opportunity) => opportunity.type === 'simplify-complex-function')).toBe(
      true,
    );
    const prompt = buildAgentPrompt(result.opportunities[0], result);
    expect(prompt).toContain('python');
  });

  it('scans Java files with alpha heuristic metrics and opportunities', async () => {
    const root = createTempProject();
    mkdirSync(path.join(root, 'src', 'main', 'java', 'com', 'example'), { recursive: true });
    writeFileSync(
      path.join(root, 'src', 'main', 'java', 'com', 'example', 'UserService.java'),
      `
package com.example;

import java.util.List;
import org.springframework.web.client.RestTemplate;

public class UserService {
  public int score(User user, List<String> roles, Request request, Audit audit, Flags flags, Clock clock) {
    if (user == null) {
      return 0;
    }
    if (roles.contains("admin")) {
      return 100;
    }
    if (request.path().contains("/beta")) {
      if (flags.beta()) {
        return 80;
      }
      return 40;
    }
    if (audit.required()) {
      if (audit.passed()) {
        return 50;
      }
      return 0;
    }
    return new RestTemplate().getForObject("https://example.com", Integer.class);
  }
}
`,
    );

    const result = await scanRepository(root, {
      ...defaultConfig,
      include: ['src/**/*.java'],
      thresholds: {
        ...defaultConfig.thresholds,
        complexFunctionComplexity: 4,
      },
    });

    const file = result.files[0];
    expect(file.language).toBe('java');
    expect(file.importCount).toBe(2);
    expect(file.functionCount).toBe(1);
    expect(file.responsibilities).toContain('data-fetching');
    expect(result.opportunities.some((opportunity) => opportunity.type === 'simplify-complex-function')).toBe(
      true,
    );
    const prompt = buildAgentPrompt(result.opportunities[0], result);
    expect(prompt).toContain('java');
  });

  it('detects deeper Python and Java framework signals and prompt test paths', async () => {
    const root = createTempProject();
    mkdirSync(path.join(root, 'src', 'billing'), { recursive: true });
    mkdirSync(path.join(root, 'src', 'main', 'java', 'com', 'example'), { recursive: true });
    writeFileSync(
      path.join(root, 'src', 'billing', 'service.py'),
      `
from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
import httpx

router = APIRouter()

class InvoiceRequest(BaseModel):
    customer_id: str = Field(min_length=1)
    amount: int

@router.post("/invoices")
async def create_invoice(payload: InvoiceRequest, db: Session, permissions, flags, audit) -> dict:
    if not permissions.get("billing"):
        return {"status": "denied"}
    if payload.amount <= 0:
        return {"status": "invalid"}
    existing = db.query(Invoice).filter(Invoice.customer_id == payload.customer_id).first()
    if existing:
        if flags.get("allow_duplicate"):
            return {"status": "duplicate_allowed"}
        return {"status": "duplicate"}
    if audit.get("required"):
        if not audit.get("passed"):
            return {"status": "audit_failed"}
    response = await httpx.AsyncClient().get("https://example.com/risk")
    if response.status_code == 200:
        return {"status": "created"}
    return {"status": "queued"}
`,
    );
    writeFileSync(
      path.join(root, 'src', 'main', 'java', 'com', 'example', 'UserService.java'),
      `
package com.example;

import java.time.Clock;
import java.util.List;
import jakarta.persistence.EntityManager;
import jakarta.validation.Valid;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.reactive.function.client.WebClient;

@RestController
public class UserService {
  private final JdbcTemplate jdbcTemplate;
  private final EntityManager entityManager;
  private final WebClient webClient;

  public UserService(JdbcTemplate jdbcTemplate, EntityManager entityManager, WebClient webClient) {
    this.jdbcTemplate = jdbcTemplate;
    this.entityManager = entityManager;
    this.webClient = webClient;
  }

  @PostMapping("/users/score")
  public int scoreUser(@Valid UserRequest request, Audit audit, Flags flags, Clock clock, List<String> roles, String token) {
    if (token == null) {
      return 0;
    }
    if (roles.contains("admin")) {
      return 100;
    }
    if (request.path().contains("/beta")) {
      if (flags.beta()) {
        return 80;
      }
      return 40;
    }
    if (audit.required()) {
      if (!audit.passed()) {
        return 0;
      }
      return 50;
    }
    if (entityManager.find(User.class, request.userId()) == null) {
      return jdbcTemplate.queryForObject("select 1", Integer.class);
    }
    return webClient.get().uri("https://example.com").retrieve().bodyToMono(Integer.class).block();
  }
}
`,
    );

    const result = await scanRepository(root, {
      ...defaultConfig,
      include: ['src/**/*.{py,java}'],
      thresholds: {
        ...defaultConfig.thresholds,
        complexFunctionComplexity: 4,
      },
    });

    expect(result.project.languages).toEqual(['java', 'python']);

    const pythonFile = result.files.find((file) => file.path === 'src/billing/service.py');
    const javaFile = result.files.find(
      (file) => file.path === 'src/main/java/com/example/UserService.java',
    );
    expect(pythonFile?.language).toBe('python');
    expect(javaFile?.language).toBe('java');
    expect(pythonFile?.functions.find((fn) => fn.name === 'create_invoice')?.isAsync).toBe(true);
    expect(javaFile?.functions.some((fn) => fn.name === 'UserService')).toBe(true);
    expect(pythonFile?.responsibilities).toEqual(
      expect.arrayContaining(['routing', 'validation', 'data-fetching', 'database']),
    );
    expect(javaFile?.responsibilities).toEqual(
      expect.arrayContaining(['routing', 'validation', 'data-fetching', 'database']),
    );

    const pythonOpportunity = result.opportunities.find(
      (opportunity) =>
        opportunity.files.includes('src/billing/service.py') &&
        ['simplify-complex-function', 'add-tests-before-refactor'].includes(opportunity.type),
    );
    const javaOpportunity = result.opportunities.find(
      (opportunity) =>
        opportunity.files.includes('src/main/java/com/example/UserService.java') &&
        ['simplify-complex-function', 'add-tests-before-refactor'].includes(opportunity.type),
    );
    expect(pythonOpportunity).toBeDefined();
    expect(javaOpportunity).toBeDefined();

    const pythonPrompt = buildAgentPrompt(pythonOpportunity!, result);
    const javaPrompt = buildAgentPrompt(javaOpportunity!, result);
    expect(pythonPrompt).toContain('src/billing/test_service.py');
    expect(javaPrompt).toContain('src/main/java/com/example/UserServiceTest.java');
    expect(pythonPrompt).not.toContain('.ts');
    expect(javaPrompt).not.toContain('.ts');
  });

  it('suggests language-appropriate helper paths for Python and Java duplicate prompts', async () => {
    const pythonRoot = createTempProject();
    mkdirSync(path.join(pythonRoot, 'src', 'billing'), { recursive: true });
    const duplicatedPython = `
def normalize_amount(value, currency):
    if value is None:
        return 0
    if currency == "USD":
        return value
    if currency == "CAD":
        return value * 1.35
    return value
`;
    writeFileSync(path.join(pythonRoot, 'src', 'billing', 'invoices.py'), duplicatedPython);
    writeFileSync(path.join(pythonRoot, 'src', 'billing', 'payments.py'), duplicatedPython);

    const pythonResult = await scanRepository(pythonRoot, {
      ...defaultConfig,
      include: ['src/**/*.py'],
      output: { ...defaultConfig.output, minPriority: 'low' },
    });
    const pythonDuplicate = pythonResult.opportunities.find(
      (opportunity) => opportunity.type === 'deduplicate-logic',
    );
    expect(pythonDuplicate).toBeDefined();
    expect(buildAgentPrompt(pythonDuplicate!, pythonResult)).toContain(
      'src/billing/extract_normalize_amount_helper.py',
    );
    expect(buildAgentPrompt(pythonDuplicate!, pythonResult)).not.toContain('.ts');

    const javaRoot = createTempProject();
    mkdirSync(path.join(javaRoot, 'src', 'main', 'java', 'com', 'example'), { recursive: true });
    const duplicatedJava = `
package com.example;

public class Placeholder {
  public int normalizeAmount(int value, String currency) {
    if (value == 0) {
      return 0;
    }
    if (currency.equals("USD")) {
      return value;
    }
    if (currency.equals("CAD")) {
      return value * 2;
    }
    return value;
  }
}
`;
    writeFileSync(
      path.join(javaRoot, 'src', 'main', 'java', 'com', 'example', 'InvoiceMath.java'),
      duplicatedJava.replace('Placeholder', 'InvoiceMath'),
    );
    writeFileSync(
      path.join(javaRoot, 'src', 'main', 'java', 'com', 'example', 'PaymentMath.java'),
      duplicatedJava.replace('Placeholder', 'PaymentMath'),
    );

    const javaResult = await scanRepository(javaRoot, {
      ...defaultConfig,
      include: ['src/**/*.java'],
      output: { ...defaultConfig.output, minPriority: 'low' },
    });
    const javaDuplicate = javaResult.opportunities.find(
      (opportunity) => opportunity.type === 'deduplicate-logic',
    );
    expect(javaDuplicate).toBeDefined();
    expect(buildAgentPrompt(javaDuplicate!, javaResult)).toContain(
      'src/main/java/com/example/ExtractNormalizeAmountHelper.java',
    );
    expect(buildAgentPrompt(javaDuplicate!, javaResult)).not.toContain('.ts');
  });
});

describe('refactor run workflow', () => {
  it('creates a tracked run without editing source files', async () => {
    const root = createTempProject();
    const sourcePath = writeMessyComponent(root);
    const config = {
      ...defaultConfig,
      include: ['src/**/*.{ts,tsx,js,jsx}'],
      thresholds: {
        ...defaultConfig.thresholds,
        largeComponentLines: 40,
        complexFunctionLines: 20,
      },
    };
    const beforeHash = hashFile(sourcePath);
    const scan = await scanRepository(root, config);
    const output = writeScanOutputs(root, config, scan);

    const nextOpportunity = getNextUnstartedOpportunity(output.outputDirectory, scan);
    expect(nextOpportunity).toBeDefined();

    const baseline = beginRun(root, output.outputDirectory, config, scan, nextOpportunity!.id);

    expect(hashFile(sourcePath)).toBe(beforeHash);
    expect(existsSync(path.join(baseline.runDirectory, 'task.md'))).toBe(true);
    expect(existsSync(path.join(baseline.runDirectory, 'baseline.json'))).toBe(true);
    expect(
      existsSync(path.join(baseline.baselineFilesDirectory, 'src/components/Dashboard.tsx')),
    ).toBe(true);
    expect(readRunBaseline(output.outputDirectory, 'latest').runId).toBe(baseline.runId);
    expect(getNextUnstartedOpportunity(output.outputDirectory, scan)?.id).not.toBe(
      nextOpportunity!.id,
    );
  });

  it('checks a run after a controlled source edit and completes it', async () => {
    const root = createTempProject();
    const sourcePath = writeMessyComponent(root);
    const config = {
      ...defaultConfig,
      include: ['src/**/*.{ts,tsx,js,jsx}'],
      thresholds: {
        ...defaultConfig.thresholds,
        largeComponentLines: 40,
        complexFunctionLines: 20,
      },
    };
    const scan = await scanRepository(root, config);
    const output = writeScanOutputs(root, config, scan);
    const baseline = beginRun(root, output.outputDirectory, config, scan, scan.opportunities[0].id);

    writeFileSync(
      sourcePath,
      readFileSync(sourcePath, 'utf8').replace('// TODO: split this component', ''),
    );

    const result = await checkRun(root, output.outputDirectory, config, baseline.runId, {
      runCommands: false,
      commands: [],
    });

    expect(result.targetComparisons.some((comparison) => comparison.changed)).toBe(true);
    expect(result.recommendation).toBe('warn');
    expect(existsSync(path.join(baseline.runDirectory, 'check.json'))).toBe(true);

    const completed = completeRun(output.outputDirectory, 'latest', 'Test completion.');
    expect(completed.baseline.status).toBe('completed');
    expect(existsSync(completed.summaryPath)).toBe(true);
  });

  it('allows dirty git repos and records dirty status when git is available', async () => {
    if (spawnSync('git', ['--version'], { encoding: 'utf8' }).status !== 0) {
      return;
    }

    const root = createTempProject();
    writeMessyComponent(root);
    spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
    writeFileSync(path.join(root, 'notes.md'), 'dirty workspace\n');

    const config = {
      ...defaultConfig,
      include: ['src/**/*.{ts,tsx,js,jsx}'],
      thresholds: {
        ...defaultConfig.thresholds,
        largeComponentLines: 40,
        complexFunctionLines: 20,
      },
    };
    const scan = await scanRepository(root, config);
    const output = writeScanOutputs(root, config, scan);
    const baseline = beginRun(root, output.outputDirectory, config, scan, scan.opportunities[0].id);

    expect(baseline.git.isRepo).toBe(true);
    expect(baseline.git.dirty).toBe(true);
    expect(baseline.git.changedFiles.length).toBeGreaterThan(0);
  });
});

describe('scan quality regressions', () => {
  it('detects Expo workspaces, avoids API false positives, and ranks large screens above tiny duplicates', async () => {
    const root = createTempProject();
    writeExpoMonorepoFixture(root);

    const result = await scanRepository(root, {
      ...defaultConfig,
      include: ['apps/**/*.{ts,tsx,js,jsx}', 'packages/**/*.{ts,tsx,js,jsx}'],
      thresholds: {
        ...defaultConfig.thresholds,
        largeFileLines: 220,
        largeComponentLines: 180,
        complexFunctionComplexity: 8,
      },
    });

    expect(result.project.framework).toBe('expo');
    expect(
      result.project.workspaces.some((workspace) => workspace.name === '@kindred/mobile'),
    ).toBe(true);

    const dimensionsOnly = result.files.find(
      (file) => file.path === 'apps/mobile/src/components/DimensionsOnly.tsx',
    );
    expect(dimensionsOnly?.signals.some((signal) => signal.type === 'api-calls-in-ui')).toBe(false);
    expect(dimensionsOnly?.responsibilities.includes('data-fetching')).toBe(false);

    const commentOnly = result.files.find(
      (file) => file.path === 'apps/mobile/src/components/CommentOnly.tsx',
    );
    expect(commentOnly?.signals.some((signal) => signal.type === 'api-calls-in-ui')).toBe(false);
    expect(commentOnly?.responsibilities.includes('data-fetching')).toBe(false);

    const duplicate = result.opportunities.find(
      (opportunity) => opportunity.title === 'Extract Shared Local File Blob Reader',
    );
    const largeScreen = result.opportunities.find((opportunity) =>
      opportunity.title.includes('SignInScreen'),
    );
    expect(duplicate).toBeDefined();
    expect(largeScreen).toBeDefined();
    expect(result.opportunities.indexOf(largeScreen!)).toBeLessThan(
      result.opportunities.indexOf(duplicate!),
    );

    const highCount = result.opportunities.filter(
      (opportunity) => opportunity.priorityLabel === 'High',
    ).length;
    expect(highCount).toBeLessThan(result.opportunities.length * 0.8);

    const prompt = buildAgentPrompt(duplicate!, result);
    expect(prompt).toContain('apps/mobile/src/lib/readLocalFileAsBlob.ts');
    expect(prompt).not.toContain('src/utils/sharedRefactorHelper.ts');
  });

  it('keeps generated agent prompts and AI summary inputs bounded', async () => {
    const root = createTempProject();
    writeExpoMonorepoFixture(root);

    const result = await scanRepository(root, {
      ...defaultConfig,
      include: ['apps/**/*.{ts,tsx,js,jsx}', 'packages/**/*.{ts,tsx,js,jsx}'],
      thresholds: {
        ...defaultConfig.thresholds,
        largeFileLines: 220,
        largeComponentLines: 180,
        complexFunctionComplexity: 8,
      },
    });

    const singleFileOpportunity = result.opportunities.find(
      (opportunity) => opportunity.files.length === 1,
    );
    const duplicateOpportunity = result.opportunities.find(
      (opportunity) => opportunity.type === 'deduplicate-logic',
    );

    expect(singleFileOpportunity).toBeDefined();
    expect(duplicateOpportunity).toBeDefined();

    const singlePrompt = buildAgentPrompt(singleFileOpportunity!, result);
    const duplicatePrompt = buildAgentPrompt(duplicateOpportunity!, result);
    const aiPromptInput = buildAiPromptInput(singleFileOpportunity!, result);
    const parsedAiInput = JSON.parse(aiPromptInput);

    expect(estimateTokens(singlePrompt)).toBeLessThanOrEqual(1000);
    expect(estimateTokens(duplicatePrompt)).toBeLessThanOrEqual(1500);
    expect(estimateTokens(aiPromptInput)).toBeLessThanOrEqual(1500);
    expect(parsedAiInput.relevantSnippets).toEqual([]);
    expect(parsedAiInput.fileSummaries[0]).not.toHaveProperty('content');
    expect(singlePrompt).not.toContain('const [email, setEmail]');
    expect(aiPromptInput).not.toContain('const [email, setEmail]');
  });
});

function createTempProject(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'refactor-coach-'));
  tempDirectories.push(directory);
  return directory;
}

function writeMessyComponent(root: string): string {
  const sourceDirectory = path.join(root, 'src', 'components');
  mkdirSync(sourceDirectory, { recursive: true });
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      dependencies: { react: '^18.0.0' },
      scripts: { typecheck: 'tsc --noEmit', test: 'vitest run' },
    }),
  );
  const sourcePath = path.join(sourceDirectory, 'Dashboard.tsx');
  writeFileSync(
    sourcePath,
    `
import React, { useEffect, useMemo, useState } from 'react';

export function Dashboard({ userId, token, region, currency, flags, onSelect }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [sort, setSort] = useState('name');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const response = await fetch('/api/dashboard?user=' + userId);
      const json = await response.json();
      setItems(json.items);
      setLoading(false);
    }
    load();
  }, [userId]);

  const visible = useMemo(() => {
    return items
      .filter((item) => filter === 'all' || item.status === filter)
      .filter((item) => item.name.includes(query))
      .sort((a, b) => a[sort] > b[sort] ? 1 : -1);
  }, [items, filter, query, sort]);

  function calculateStatus(item, permissions, now, fallback, options, audit) {
    if (!item) return fallback;
    if (item.disabled) {
      if (permissions.canRestore) return 'restorable';
      return 'disabled';
    }
    if (item.expiry) {
      if (item.expiry < now) {
        if (options.allowExpired) return 'expired_allowed';
        return 'expired';
      }
      if (item.expiry === now) return 'expires_today';
    }
    if (item.owner === userId) {
      if (audit.required) return 'audit';
      return 'owned';
    }
    return 'active';
  }

  // TODO: split this component
  return (
    <section style={{ padding: 20 }}>
      {loading && <p>Loading</p>}
      {error && <p>{error}</p>}
      {visible.map((item) => (
        <button key={item.id} onClick={() => onSelect(calculateStatus(item, {}, Date.now(), 'none', {}, {}))}>
          {item.name}
        </button>
      ))}
    </section>
  );
}
`,
  );
  return sourcePath;
}

function hashFile(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function countTaskHeadings(markdown: string): number {
  return (markdown.match(/^## \d+\. /gm) ?? []).length;
}

function estimateTokens(markdown: string): number {
  const compact = markdown.replace(/\s+/g, ' ').trim();
  return Math.ceil(compact.length / 4);
}

function writeExpoMonorepoFixture(root: string): void {
  mkdirSync(path.join(root, 'apps', 'mobile', 'src', 'components'), { recursive: true });
  mkdirSync(path.join(root, 'apps', 'mobile', 'app', '(auth)'), { recursive: true });
  mkdirSync(path.join(root, 'apps', 'mobile', 'app', 'friends', '[id]'), { recursive: true });
  mkdirSync(path.join(root, 'packages', 'shared', 'src'), { recursive: true });
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      private: true,
      workspaces: ['apps/*', 'packages/*'],
      scripts: { typecheck: 'tsc -b', test: 'vitest run' },
      devDependencies: { vitest: '^3.0.0' },
    }),
  );
  writeFileSync(
    path.join(root, 'apps', 'mobile', 'package.json'),
    JSON.stringify({
      name: '@kindred/mobile',
      dependencies: {
        expo: '^54.0.0',
        'expo-router': '^6.0.0',
        'react-native': '^0.81.0',
        react: '^19.0.0',
      },
      scripts: { typecheck: 'tsc --noEmit', lint: 'eslint .' },
    }),
  );
  writeFileSync(
    path.join(root, 'apps', 'mobile', 'app.json'),
    JSON.stringify({ expo: { name: 'Kindred' } }),
  );
  writeFileSync(
    path.join(root, 'packages', 'shared', 'package.json'),
    JSON.stringify({ name: '@kindred/shared', dependencies: { zod: '^3.0.0' } }),
  );
  writeFileSync(
    path.join(root, 'apps', 'mobile', 'src', 'components', 'DimensionsOnly.tsx'),
    `
import { Dimensions, Text } from 'react-native';

const { width } = Dimensions.get('window');

export function DimensionsOnly() {
  return <Text>{width}</Text>;
}
`,
  );
  writeFileSync(
    path.join(root, 'apps', 'mobile', 'src', 'components', 'CommentOnly.tsx'),
    `
import { Text } from 'react-native';

// fetch().blob() is not supported for local file URIs in Hermes.
export function CommentOnly() {
  return <Text>No network calls here</Text>;
}
`,
  );
  writeFileSync(
    path.join(root, 'apps', 'mobile', 'app', 'friends', '[id]', 'voice.tsx'),
    blobReaderScreen('VoiceLogScreen', 'friendVoice'),
  );
  writeFileSync(
    path.join(root, 'apps', 'mobile', 'src', 'components', 'VoiceFillSheet.tsx'),
    blobReaderScreen('VoiceFillSheet', 'voiceFill'),
  );
  writeFileSync(
    path.join(root, 'apps', 'mobile', 'app', '(auth)', 'sign-in.tsx'),
    largeSignInScreen(),
  );
}

function blobReaderScreen(componentName: string, label: string): string {
  return `
import { useState } from 'react';
import { Text } from 'react-native';

export default function ${componentName}() {
  const [value, setValue] = useState('');

  async function readLocal(uri: string) {
    const blob = await new Promise<Blob>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.onload = () => resolve(xhr.response as Blob);
      xhr.onerror = () => reject(new TypeError('Failed to read audio file'));
      xhr.responseType = 'blob';
      xhr.open('GET', uri, true);
      xhr.send(null);
    });
    setValue(String(blob.size));
  }

  void readLocal('${label}.m4a');
  return <Text>{value}</Text>;
}
`;
}

function largeSignInScreen(): string {
  const repeatedJsx = Array.from(
    { length: 35 },
    (_, index) => `<Text>{email}-${index}</Text>`,
  ).join('\n');
  return `
import { useState } from 'react';
import { Text, View } from 'react-native';

export default function SignInScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [error, setError] = useState<string | null>(null);

  function formatAuthError(error: unknown) {
    if (error instanceof TypeError) {
      if (error.message.includes('Network')) return 'Network unavailable';
      return 'Unexpected network problem';
    }
    if (error instanceof Error) {
      if (error.message.includes('email')) return 'Email issue';
      if (error.message.includes('password')) return 'Password issue';
      if (error.message.includes('registered')) return 'Already registered';
    }
    return 'Unknown';
  }

  async function submit() {
    if (!email) {
      setError('Missing email');
      return;
    }
    if (password.length < 8) {
      setError('Password too short');
      return;
    }
    if (mode === 'sign-up') {
      if (email.endsWith('@example.com')) setError('Use a real email');
      else setError(null);
    } else {
      setError(null);
    }
  }

  void submit;
  void setEmail;
  void setPassword;
  void setMode;
  void formatAuthError;

  return (
    <View>
      {error ? <Text>{error}</Text> : null}
      ${repeatedJsx}
    </View>
  );
}
`;
}
