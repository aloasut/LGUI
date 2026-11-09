// 开发用：取 Noto Sans SC Regular（SIL OFL 1.1）。来源固定为 Google 官方仓库 notofonts/noto-cjk 的标签 Sans2.004，
// 下载后核对 SHA-256，存在系统临时目录里反复用（不进仓库）。测试样本（scripts/fonts/sample.mjs）和字体性能对比（bench.mjs）用它。
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const NOTO = {
  url: 'https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf',
  sha256: 'faa6c9df652116dde789d351359f3d7e5d2285a2b2a1f04a2d7244df706d5ea9'
};

/** 本机缓存里的 Noto Sans SC Regular（8.3 MB）；没有就下载。 */
export async function notoSansSC() {
  const file = path.join(os.tmpdir(), 'lgui-fonts', 'NotoSansSC-Regular.otf');
  const ok = () => fs.existsSync(file) && crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') === NOTO.sha256;
  if (ok()) return file;
  console.log(`下载 ${NOTO.url} …`);
  const response = await fetch(NOTO.url);
  if (!response.ok) throw new Error(`下载 Noto Sans SC 失败：HTTP ${response.status}`);
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  if (!ok()) throw new Error(`下载的 Noto Sans SC 和记录的 SHA-256 不一致：${file}`);
  return file;
}

/** 测试样本和性能对比用的字：常用字加大厅界面常见的词（约 400 个汉字）。「齉」「龘」故意不收：测试用它们当字体里没有的字。 */
export const SAMPLE_TEXT = '的一是不了人我在有他这中大来上个国到说们为子和你地出道也时年得就那要下以生会自着去之过家学对可她里后小么心多天而能好都然没日于起还发成事只作当想看文无开手十用主行方又如前所本见经头面公同三已老从动两长知民样现分将外但身些与高意进把法此实回二理美点月明其种声全工己话儿者向情部正名定女问力机给等几很业最间新什打便位因重被走电四第门相次东政海口使教西再平真听世气信北少关并内加化由却代军产入先山五太水万市眼体别处总才场师书比住员九笑性通目华报立马命张活难神数件安表原车白应路期叫死常提感金何更反合放做系计或司利受光王果亲界及今京务制解各任至清物台象记边共风战干接它许八特觉望直服毛林题建南度统色字请交爱让认算论百吃义科怎元社术结六功指思非流每青管夫连远资队跑火毫钻石体力等级经验确定取消返回关闭设置背包商店邮件好友排行榜签到活动游戏开始亿萬億兆售示载提取确，。！？：；“”、（）《》…—·';
