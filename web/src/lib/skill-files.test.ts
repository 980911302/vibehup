import { describe, it, expect } from 'vitest';
import { arrangeSkillFiles, formatSize, stripFrontmatter } from './skill-files';

describe('技能文件整理', () => {
  it('选文件夹：以最浅的 SKILL.md 为根，剥掉目录前缀，跳过系统垃圾文件', () => {
    const r = arrangeSkillFiles([
      { path: 'my-skill/SKILL.md' },
      { path: 'my-skill/scripts/a.sh' },
      { path: 'my-skill/.DS_Store' },
      { path: 'my-skill/examples/SKILL.md' },
      { path: 'my-skill/.git/config' },
    ]);
    expect(r?.skillMd.path).toBe('my-skill/SKILL.md');
    expect(r?.files.map((f) => f.path)).toEqual(['scripts/a.sh', 'examples/SKILL.md']);
  });

  it('单选文件：SKILL.md 与其他文件都在根目录', () => {
    const r = arrangeSkillFiles([{ path: 'run.sh' }, { path: 'SKILL.md' }]);
    expect(r?.skillMd.path).toBe('SKILL.md');
    expect(r?.files.map((f) => f.path)).toEqual(['run.sh']);
  });

  it('没有 SKILL.md 返回 null', () => {
    expect(arrangeSkillFiles([{ path: 'a/readme.md' }])).toBeNull();
  });

  it('渲染前去掉 frontmatter；文件大小人话', () => {
    expect(stripFrontmatter('---\nname: a\ndescription: b\n---\n\n# 正文')).toBe('\n# 正文');
    expect(stripFrontmatter('# 没有头')).toBe('# 没有头');
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(2048)).toBe('2.0 KB');
  });
});
