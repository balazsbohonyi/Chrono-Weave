import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownContentProps {
  children: string;
  className?: string;
  inline?: boolean;
}

const inlineElements = ['a', 'br', 'code', 'del', 'em', 'strong'];

const MarkdownContent: React.FC<MarkdownContentProps> = ({ children, className = '', inline = false }) => {
  const content = (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      allowedElements={inline ? inlineElements : undefined}
      unwrapDisallowed={inline}
      components={{
        a: ({ node, href, children, ...props }) => href
          ? <a {...props} href={href} target={href.startsWith('#') ? undefined : '_blank'} rel="noopener noreferrer">{children}</a>
          : <span>{children}</span>,
      }}
    >
      {children}
    </ReactMarkdown>
  );
  const classes = `markdown-content ${className}`;
  return inline ? <span className={classes}>{content}</span> : <div className={classes}>{content}</div>;
};

export default MarkdownContent;
