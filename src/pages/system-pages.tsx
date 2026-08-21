import { Button } from "@/components/ui/button"
import { Link } from "react-router-dom"
import { PageContainer } from "@/components/app/page"

export function ForbiddenPage() {
  return (
    <PageContainer>
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-24 text-center">
        <div className="text-3xl font-semibold tabular-nums">403</div>
        <div className="text-sm font-medium">无访问权限</div>
        <p className="max-w-md text-xs text-muted-foreground">
          当前账号没有该页面的查看权限。如需访问，请联系系统管理员授权。
        </p>
        <Button asChild variant="outline" size="sm" className="mt-2">
          <Link to="/quality/overview">返回质量总览</Link>
        </Button>
      </div>
    </PageContainer>
  )
}

export function NotFoundPage() {
  return (
    <PageContainer>
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-24 text-center">
        <div className="text-3xl font-semibold tabular-nums">404</div>
        <div className="text-sm font-medium">页面不存在</div>
        <p className="max-w-md text-xs text-muted-foreground">
          你访问的地址不存在或已经被移除。
        </p>
        <Button asChild variant="outline" size="sm" className="mt-2">
          <Link to="/quality/overview">返回质量总览</Link>
        </Button>
      </div>
    </PageContainer>
  )
}
