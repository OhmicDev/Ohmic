import { Link } from '@tanstack/react-router'
import { PageTitle } from '../ui/Primitives'

/** Shown for an address the app doesn't have, e.g. an old bookmark. */
export function NotFoundPage() {
  return (
    <>
      <PageTitle title="Page not found" subtitle="This address isn’t part of Ohmic, or it moved." />
      <Link
        to="/"
        className="focus-ring inline-flex h-10 items-center rounded-xl bg-accent px-4 text-sm font-semibold text-black transition-opacity hover:opacity-90"
      >
        Go to Ride
      </Link>
    </>
  )
}
