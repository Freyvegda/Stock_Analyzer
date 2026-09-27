/**
 * Fundamentals layout: side rail + content column. Shared screen-run state
 * moves in here when the criteria and top-10 pages split apart.
 */

import { Outlet } from 'react-router-dom'
import { FundamentalNav } from '@/components/FundamentalNav'

export default function FundamentalsLayout() {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-start">
      <aside className="md:sticky md:top-24 md:w-56 md:shrink-0">
        <FundamentalNav />
      </aside>
      <div className="min-w-0 flex-1 space-y-4">
        <Outlet />
      </div>
    </div>
  )
}
