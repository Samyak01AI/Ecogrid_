import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface SafeMarkdownProps {
  content: string;
  className?: string;
}

export const SafeMarkdown: React.FC<SafeMarkdownProps> = ({ content, className = '' }) => {
  if (!content) return null;

  return (
    <div className={`safe-markdown-root ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ children, ...props }) => (
            <div className="table-responsive-wrapper">
              <table className="ai-md-table" {...props}>
                {children}
              </table>
            </div>
          ),
          thead: ({ children, ...props }) => (
            <thead className="ai-md-thead" {...props}>
              {children}
            </thead>
          ),
          tbody: ({ children, ...props }) => (
            <tbody className="ai-md-tbody" {...props}>
              {children}
            </tbody>
          ),
          tr: ({ children, ...props }) => (
            <tr className="ai-md-tr" {...props}>
              {children}
            </tr>
          ),
          th: ({ children, ...props }) => (
            <th className="ai-md-th" {...props}>
              {children}
            </th>
          ),
          td: ({ children, ...props }) => (
            <td className="ai-md-td" {...props}>
              {children}
            </td>
          ),
          h1: ({ children, ...props }) => (
            <h3 className="ai-md-h3" {...props}>
              {children}
            </h3>
          ),
          h2: ({ children, ...props }) => (
            <h4 className="ai-md-h4" {...props}>
              {children}
            </h4>
          ),
          h3: ({ children, ...props }) => (
            <h5 className="ai-md-h5" {...props}>
              {children}
            </h5>
          ),
          h4: ({ children, ...props }) => (
            <h6 className="ai-md-h6" {...props}>
              {children}
            </h6>
          ),
          p: ({ children, ...props }) => (
            <p className="ai-md-p" {...props}>
              {children}
            </p>
          ),
          ul: ({ children, ...props }) => (
            <ul className="ai-md-ul" {...props}>
              {children}
            </ul>
          ),
          ol: ({ children, ...props }) => (
            <ol className="ai-md-ol" {...props}>
              {children}
            </ol>
          ),
          li: ({ children, ...props }) => (
            <li className="ai-md-li" {...props}>
              {children}
            </li>
          ),
          hr: (props) => <hr className="ai-md-hr" {...props} />,
          blockquote: ({ children, ...props }) => (
            <blockquote className="ai-md-blockquote" {...props}>
              {children}
            </blockquote>
          ),
          a: ({ children, href, ...props }) => (
            <a
              className="ai-md-link"
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              {...props}
            >
              {children}
            </a>
          ),
          code: ({ children, className: codeClassName, ...props }) => {
            const isInline = !codeClassName && typeof children === 'string' && !children.includes('\n');
            if (isInline) {
              return (
                <code className="ai-md-inline-code" {...props}>
                  {children}
                </code>
              );
            }
            return (
              <pre className="ai-md-pre">
                <code className={codeClassName} {...props}>
                  {children}
                </code>
              </pre>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};
