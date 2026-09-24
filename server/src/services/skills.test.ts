import { describe, it, expect, beforeEach } from 'vitest';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { prisma } from '../core/prisma.js';
import { resetDb } from '../test-helpers.js';
import * as projectsService from './projects.js';
import * as skillsService from './skills.js';

/** 技能域：SKILL.md 解析、上传即新建或覆盖、项目/通用归属、附带文件、zip 进出 */

beforeEach(async () => {
  await resetDb();
});

const md = (name: string, description = '按团队约定写提交信息', body = '# 用法\n照做即可') =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;

const file = (path: string, text: string) => ({ path, data: Buffer.from(text) });

describe('SKILL.md 解析', () => {
  it('读出 name / description，支持引号、折叠块、CRLF 与 BOM', () => {
    expect(skillsService.parseSkillMd(md('commit-style'))).toMatchObject({ name: 'commit-style', description: '按团队约定写提交信息' });
    expect(skillsService.parseSkillMd('﻿---\r\nname: "a-b"\r\ndescription: \'单引号描述\'\r\n---\r\n正文').description).toBe('单引号描述');
    const folded = skillsService.parseSkillMd('---\nname: fold\ndescription: >\n  第一行\n  第二行\nlicense: MIT\n---\n');
    expect(folded.description).toBe('第一行 第二行');
  });

  it('缺 frontmatter / 缺 description / 名字不合规，都给出人话提示', () => {
    expect(() => skillsService.parseSkillMd('# 没有头')).toThrow('frontmatter');
    expect(() => skillsService.parseSkillMd('---\nname: x\n---\n')).toThrow('description');
    expect(() => skillsService.parseSkillMd('---\ndescription: d\n---\n')).toThrow('name');
    expect(() => skillsService.parseSkillMd(md('Commit Style'))).toThrow('小写字母、数字和连字符');
    expect(() => skillsService.parseSkillMd(md('a'.repeat(65)))).toThrow('64');
  });
});

describe('上传技能', () => {
  it('新建带附带文件；同一范围同名再次上传即覆盖（文件整体替换）', async () => {
    const p = await projectsService.createProject({ name: 'P', slug: 'p' });
    const first = await skillsService.uploadSkill({
      projectId: p.id, skillMd: md('deploy'), files: [file('scripts/run.sh', 'echo 1'), file('ref/a.md', 'A')], uploadedBy: 'usr_1',
    });
    expect(first.action).toBe('created');
    expect(first.skill).toMatchObject({ name: 'deploy', projectId: p.id, source: 'human', uploadedBy: 'usr_1' });

    const second = await skillsService.uploadSkill({
      projectId: p.id, skillMd: md('deploy', '新描述'), files: [file('scripts/run.sh', 'echo 2')], source: 'ai',
    });
    expect(second.action).toBe('updated');
    expect(second.skill.id).toBe(first.skill.id);
    expect(second.skill).toMatchObject({ description: '新描述', source: 'ai' });
    const files = await prisma.skillFile.findMany({ where: { skillId: first.skill.id } });
    expect(files.map((f) => [f.path, Buffer.from(f.content).toString()])).toEqual([['scripts/run.sh', 'echo 2']]);
  });

  it('项目技能与通用技能同名互不覆盖', async () => {
    const p = await projectsService.createProject({ name: 'P', slug: 'p' });
    const a = await skillsService.uploadSkill({ projectId: p.id, skillMd: md('lint') });
    const b = await skillsService.uploadSkill({ projectId: null, skillMd: md('lint') });
    expect(b.action).toBe('created');
    expect(b.skill.id).not.toBe(a.skill.id);
    expect(b.skill.projectId).toBeNull();
  });

  it('文件路径归一并拦住越界路径、重复路径、根目录 SKILL.md', async () => {
    const up = (files: { path: string; data: Buffer }[]) => skillsService.uploadSkill({ projectId: null, skillMd: md('paths'), files });
    const ok = await up([file('.\\scripts\\run.sh', 'x')]);
    expect((await prisma.skillFile.findFirst({ where: { skillId: ok.skill.id } }))?.path).toBe('scripts/run.sh');
    await expect(up([file('../etc/passwd', 'x')])).rejects.toThrow('路径');
    await expect(up([file('/abs.sh', 'x')])).rejects.toThrow('路径');
    await expect(up([file('a.sh', 'x'), file('./a.sh', 'y')])).rejects.toThrow('重复');
    await expect(up([file('SKILL.md', 'x')])).rejects.toThrow('SKILL.md');
  });

  it('大小与数量上限', async () => {
    const up = (files: { path: string; data: Buffer }[]) => skillsService.uploadSkill({ projectId: null, skillMd: md('big'), files });
    await expect(up([{ path: 'big.bin', data: Buffer.alloc(1024 * 1024 + 1) }])).rejects.toThrow('1MB');
    await expect(up(Array.from({ length: 101 }, (_, i) => file(`f${i}.txt`, 'x')))).rejects.toThrow('100');
  });

  it('项目不存在时拒绝', async () => {
    await expect(skillsService.uploadSkill({ projectId: 'prj_nope', skillMd: md('x') })).rejects.toThrow('项目不存在');
  });
});

describe('查看技能', () => {
  it('按项目列出：本项目 + 通用，别的项目不出现；可只看本项目；关键词过滤', async () => {
    const p = await projectsService.createProject({ name: 'P', slug: 'p' });
    const other = await projectsService.createProject({ name: 'O', slug: 'o' });
    await skillsService.uploadSkill({ projectId: p.id, skillMd: md('b-proj'), files: [file('x.txt', 'abc')] });
    await skillsService.uploadSkill({ projectId: null, skillMd: md('a-global', '所有项目都要用的约定') });
    await skillsService.uploadSkill({ projectId: other.id, skillMd: md('c-other') });

    const list = await skillsService.listSkills({ projectId: p.id });
    expect(list.map((s) => s.name)).toEqual(['a-global', 'b-proj']);
    expect(list.find((s) => s.name === 'b-proj')).toMatchObject({ fileCount: 1, totalSize: 3 });

    expect((await skillsService.listSkills({ projectId: p.id, includeGlobal: false })).map((s) => s.name)).toEqual(['b-proj']);
    expect((await skillsService.listSkills({ projectId: p.id, q: '所有项目' })).map((s) => s.name)).toEqual(['a-global']);
    expect((await skillsService.listSkills({})).map((s) => s.name)).toEqual(['a-global', 'b-proj', 'c-other']);
  });

  it('详情带文件清单并区分文本/二进制；单文件可读', async () => {
    const s = await skillsService.uploadSkill({
      projectId: null, skillMd: md('files'),
      files: [file('run.sh', '#!/bin/sh\necho 你好'), { path: 'logo.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]) }],
    });
    const detail = await skillsService.getSkillDetail(s.skill.id);
    expect(detail.files).toEqual([
      { path: 'logo.png', size: 7, isText: false },
      { path: 'run.sh', size: Buffer.byteLength('#!/bin/sh\necho 你好'), isText: true },
    ]);
    const f = await skillsService.getSkillFile(s.skill.id, 'run.sh');
    expect(f.data.toString()).toContain('你好');
    await expect(skillsService.getSkillFile(s.skill.id, 'nope.txt')).rejects.toThrow('文件不存在');
  });
});

describe('zip 进出', () => {
  it('从 zip 读出技能：剥掉唯一的顶层目录，忽略 __MACOSX 和 .DS_Store', () => {
    const zip = zipSync({
      'my-skill/SKILL.md': strToU8(md('my-skill')),
      'my-skill/scripts/a.sh': strToU8('echo a'),
      'my-skill/.DS_Store': strToU8('junk'),
      '__MACOSX/my-skill/._SKILL.md': strToU8('junk'),
    });
    const parsed = skillsService.readSkillZip(Buffer.from(zip));
    expect(parsed.skillMd).toContain('name: my-skill');
    expect(parsed.files.map((f) => f.path)).toEqual(['scripts/a.sh']);
  });

  it('zip 里没有 SKILL.md 时人话报错', () => {
    const zip = zipSync({ 'a/readme.md': strToU8('x') });
    expect(() => skillsService.readSkillZip(Buffer.from(zip))).toThrow('SKILL.md');
    expect(() => skillsService.readSkillZip(Buffer.from('not a zip'))).toThrow('zip');
  });

  it('打包下载：<name>/SKILL.md + 附带文件，可原样解开', async () => {
    const s = await skillsService.uploadSkill({ projectId: null, skillMd: md('pack'), files: [file('scripts/a.sh', 'echo a')] });
    const { fileName, data } = await skillsService.buildSkillZip(s.skill.id);
    expect(fileName).toBe('pack.zip');
    const entries = unzipSync(new Uint8Array(data));
    expect(Object.keys(entries).sort()).toEqual(['pack/SKILL.md', 'pack/scripts/a.sh']);
    expect(strFromU8(entries['pack/SKILL.md'])).toContain('name: pack');
  });
});

describe('调整归属与删除', () => {
  it('可在项目与通用之间移动；目标范围已有同名技能时拒绝', async () => {
    const p = await projectsService.createProject({ name: 'P', slug: 'p' });
    const s = await skillsService.uploadSkill({ projectId: p.id, skillMd: md('move') });
    const moved = await skillsService.setSkillProject(s.skill.id, null);
    expect(moved.projectId).toBeNull();

    await skillsService.uploadSkill({ projectId: p.id, skillMd: md('move') });
    await expect(skillsService.setSkillProject(s.skill.id, p.id)).rejects.toThrow('已有同名技能');
    await expect(skillsService.setSkillProject(s.skill.id, 'prj_nope')).rejects.toThrow('项目不存在');
  });

  it('删除技能连同附带文件', async () => {
    const s = await skillsService.uploadSkill({ projectId: null, skillMd: md('gone'), files: [file('a.txt', 'a')] });
    await skillsService.deleteSkill(s.skill.id);
    expect(await prisma.skill.count()).toBe(0);
    expect(await prisma.skillFile.count()).toBe(0);
    await expect(skillsService.deleteSkill(s.skill.id)).rejects.toThrow('技能不存在');
  });
});
