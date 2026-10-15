import { observer } from "mobx-react";
import { Star } from "lucide-react";
import { Button } from "@plane/propel/button";
import { IconButton } from "@plane/propel/icon-button";
import { useEntityFavorite } from "@/hooks/use-entity-favorite";
import type { UseEntityFavoriteProps } from "@/hooks/use-entity-favorite";

type Props = UseEntityFavoriteProps & {
  variant?: "icon" | "button";
  className?: string;
};

export const EntityFavoriteControl = observer(function EntityFavoriteControl(props: Props) {
  const { variant = "button", className = "", ...favoriteProps } = props;
  const { isFavorite, pending, toggle, label, ready } = useEntityFavorite(favoriteProps);
  const iconClassName = isFavorite ? "fill-current" : "";
  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    void toggle();
  };

  if (!ready) return null;

  if (variant === "icon") {
    return (
      <IconButton
        variant="secondary"
        size="lg"
        icon={Star}
        iconClassName={iconClassName}
        className={className}
        aria-label={label}
        aria-pressed={isFavorite}
        title={label}
        disabled={pending}
        onClick={handleClick}
      />
    );
  }

  return (
    <Button
      variant="secondary"
      size="lg"
      className={className}
      aria-pressed={isFavorite}
      disabled={pending}
      onClick={handleClick}
    >
      <Star className={`size-4 ${iconClassName}`} aria-hidden="true" />
      <span>{label}</span>
    </Button>
  );
});
