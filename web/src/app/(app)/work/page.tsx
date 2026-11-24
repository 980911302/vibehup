'use client';

import BoardPage from '../board/page';

/** /work 直接展示当前项目的缺陷工作区，彻底去掉重复套娃的「我的队列」二级层 */
export default function WorkPage() {
  return <BoardPage />;
}
