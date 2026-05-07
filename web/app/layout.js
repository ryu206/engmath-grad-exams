import './globals.css';

export const metadata = {
  title: '工程數學研究所考古題',
  description: '工程數學研究所考古題與解答管理系統',
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
