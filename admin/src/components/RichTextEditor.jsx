import React from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import TextAlign from '@tiptap/extension-text-align';
import Placeholder from '@tiptap/extension-placeholder';
import { Button, ButtonGroup, InlineStack } from '@shopify/polaris';
import './RichTextEditor.css';

const RichTextEditor = ({ content, onChange, placeholder = 'Write your message...' }) => {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          target: '_blank',
          rel: 'noopener noreferrer',
        },
      }),
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Placeholder.configure({
        placeholder,
      }),
    ],
    content,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      onChange(html);
    },
  });

  if (!editor) {
    return null;
  }

  const addLink = () => {
    const url = window.prompt('Enter URL:');
    if (url) {
      editor.chain().focus().setLink({ href: url }).run();
    }
  };

  return (
    <div className="rich-text-editor">
      <div className="editor-toolbar">
        <InlineStack gap="200">
          <ButtonGroup variant="segmented">
            <Button
              size="slim"
              pressed={editor.isActive('bold')}
              onClick={() => editor.chain().focus().toggleBold().run()}
            >
              <strong>B</strong>
            </Button>
            <Button
              size="slim"
              pressed={editor.isActive('italic')}
              onClick={() => editor.chain().focus().toggleItalic().run()}
            >
              <em>I</em>
            </Button>
            <Button
              size="slim"
              pressed={editor.isActive('underline')}
              onClick={() => editor.chain().focus().toggleUnderline().run()}
            >
              <u>U</u>
            </Button>
          </ButtonGroup>

          <ButtonGroup variant="segmented">
            <Button
              size="slim"
              pressed={editor.isActive('bulletList')}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
            >
              • List
            </Button>
            <Button
              size="slim"
              pressed={editor.isActive('orderedList')}
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
            >
              1. List
            </Button>
          </ButtonGroup>

          <ButtonGroup variant="segmented">
            <Button
              size="slim"
              pressed={editor.isActive({ textAlign: 'left' })}
              onClick={() => editor.chain().focus().setTextAlign('left').run()}
            >
              Left
            </Button>
            <Button
              size="slim"
              pressed={editor.isActive({ textAlign: 'center' })}
              onClick={() => editor.chain().focus().setTextAlign('center').run()}
            >
              Center
            </Button>
            <Button
              size="slim"
              pressed={editor.isActive({ textAlign: 'right' })}
              onClick={() => editor.chain().focus().setTextAlign('right').run()}
            >
              Right
            </Button>
          </ButtonGroup>

          <Button
            size="slim"
            pressed={editor.isActive('link')}
            onClick={addLink}
          >
            Link
          </Button>

          {editor.isActive('link') && (
            <Button
              size="slim"
              onClick={() => editor.chain().focus().unsetLink().run()}
            >
              Remove Link
            </Button>
          )}
        </InlineStack>
      </div>

      <div className="editor-content-wrapper">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
};

export default RichTextEditor;
