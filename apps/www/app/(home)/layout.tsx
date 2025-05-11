import type { ReactNode } from 'react';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions } from '@/app/layout.config';
import { Footer } from '@/components/ui/footer';

export default function Layout({
  children,
}: {
  children: ReactNode;
}): React.ReactElement {
  return (
    <HomeLayout {...baseOptions} links={[
      {
        text: 'Docs',
        url: '/docs',
      },
      {
        text: 'Contact',
        url: '/contact',
        active: 'nested-url',
      },
      {
        text: 'Changelog',
        url: '/changelog',
        active: 'nested-url',
      },
    ]}>
      <div className="fixed inset-0 pointer-events-none">
      </div>
      <div className="relative min-h-screen w-full">
        {children}
        <Footer />
      </div>
    </HomeLayout>
  );
}
