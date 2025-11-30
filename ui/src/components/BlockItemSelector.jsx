import { useState, useEffect, useRef, useMemo } from 'react';

/**
 * Searchable dropdown for selecting blocks/items from minecraft-data
 */
export function BlockItemSelector({ 
  items = [], 
  value = '', 
  onChange, 
  placeholder = 'Search items...',
  disabled = false,
}) {
  const [search, setSearch] = useState(value);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  // Filter items based on search
  const filteredItems = useMemo(() => {
    if (!search) return items.slice(0, 50);
    
    const searchLower = search.toLowerCase();
    return items
      .filter(item => {
        const name = typeof item === 'string' ? item : item.name;
        return name.toLowerCase().includes(searchLower);
      })
      .slice(0, 50);
  }, [items, search]);

  // Update search when value changes externally
  useEffect(() => {
    setSearch(value);
  }, [value]);

  // Reset highlight when filtered items change
  useEffect(() => {
    setHighlightedIndex(0);
  }, [filteredItems]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = (e) => {
    setSearch(e.target.value);
    setIsOpen(true);
    onChange?.(e.target.value);
  };

  const handleSelect = (item) => {
    const name = typeof item === 'string' ? item : item.name;
    setSearch(name);
    onChange?.(name);
    setIsOpen(false);
    inputRef.current?.blur();
  };

  const handleKeyDown = (e) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setIsOpen(true);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex((prev) => 
          Math.min(prev + 1, filteredItems.length - 1)
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((prev) => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (filteredItems[highlightedIndex]) {
          handleSelect(filteredItems[highlightedIndex]);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        break;
    }
  };

  const getItemName = (item) => typeof item === 'string' ? item : item.name;
  const formatDisplayName = (name) => name.replace(/_/g, ' ');

  return (
    <div className="mc-autocomplete" ref={containerRef}>
      <input
        ref={inputRef}
        type="text"
        className="mc-input"
        value={search}
        onChange={handleInputChange}
        onFocus={() => setIsOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
      />
      
      {isOpen && filteredItems.length > 0 && (
        <div className="mc-autocomplete__dropdown">
          {filteredItems.map((item, index) => {
            const name = getItemName(item);
            return (
              <div
                key={name}
                className={`mc-autocomplete__item ${
                  index === highlightedIndex ? 'mc-autocomplete__item--highlighted' : ''
                }`}
                onClick={() => handleSelect(item)}
                onMouseEnter={() => setHighlightedIndex(index)}
              >
                {formatDisplayName(name)}
              </div>
            );
          })}
        </div>
      )}
      
      {isOpen && filteredItems.length === 0 && search && (
        <div className="mc-autocomplete__dropdown">
          <div className="mc-autocomplete__item" style={{ color: 'var(--mc-stone)' }}>
            No items found
          </div>
        </div>
      )}
    </div>
  );
}

export default BlockItemSelector;

